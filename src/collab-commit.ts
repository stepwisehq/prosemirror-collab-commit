import { Schema, Node } from "prosemirror-model"
import {Plugin, PluginKey, TextSelection, EditorState, Transaction} from "prosemirror-state"
import {Mapping, Step, Transform} from "prosemirror-transform"


export interface CommitJSON {
  version: number,
  ref: string
  steps: {[key: string]: unknown}[]
}

export interface NodeJSON {
  [key: string]: unknown
}

export class Commit {
  constructor(
    readonly version: number,
    readonly ref: string,
    readonly steps: Step[]
  ) {}

  toJSON() {
    return {
      version: this.version,
      ref: this.ref,
      steps: this.steps.map(s => s.toJSON())
    } as CommitJSON
  }

  /** Return a new commit with the steps linked to the supplied schema. */
  toSchema(schema: Schema) {
    const steps = this.steps.map(s => s.toJSON()).map(s => Step.fromJSON(schema, s))
    return new Commit(this.version, this.ref, steps)
  }

  /** Return a commit based on the supplied JSON and schema. */
  static FromJSON(schema: Schema, spec: CommitJSON) {
    const steps = spec.steps.map(s => Step.fromJSON(schema, s))
    return new Commit(spec.version, spec.ref, steps)
  }
}

export class Rebaseable {
  constructor(
    readonly step: Step,
    readonly inverted: Step,
    readonly origin: Transform
  ) {}
}

/**
 * Maps a set of steps back through each their ancestors so
 * they are all based off the same doc starting doc state.
*/
export function neutralizeSteps(steps: readonly Step[]) {
  const map = new Mapping(steps.map(s => s.getMap()))

  const backMapping = map.invert()
  const neutralSteps: Step[] = []

  for (let i = 0, mapFrom = steps.length; i < steps.length; i++) {
    const backMap = backMapping.slice(mapFrom)
    mapFrom--

    const mapped = steps[i].map(backMap)

    if (!mapped) throw new Error('Neutralizing steps failed!')

    neutralSteps.push(mapped)
  }

  return neutralSteps
}


/// Undo a given set of steps, apply a set of other steps, and then
/// redo them @internal
export function rebaseSteps(steps: readonly Rebaseable[], over: readonly Step[], transform: Transform) {
  for (let i = steps.length - 1; i >= 0; i--) transform.step(steps[i].inverted)
  for (let i = 0; i < over.length; i++) transform.step(over[i])
  let result = []
  for (let i = 0, mapFrom = steps.length; i < steps.length; i++) {
    let mapped = steps[i].step.map(transform.mapping.slice(mapFrom))
    mapFrom--
    if (mapped && !transform.maybeStep(mapped).failed) {
      // @ts-ignore
      transform.mapping.setMirror(mapFrom, transform.steps.length - 1)
      result.push(new Rebaseable(mapped, mapped.invert(transform.docs[transform.docs.length - 1]), steps[i].origin))
    }
  }
  return result
}

// This state field accumulates changes that have to be sent to the
// central authority in the collaborating group and makes it possible
// to integrate changes made by peers into our local document. It is
// defined by the plugin, and will be available as the `collab` field
// in the resulting editor state.
export class CollabState {
  /** Next expected version */
  get nextVersion() { return this.version + 1 }

  constructor(
    // The version number of the last commit received from the central
    // authority. Starts at 0 or the value of the `version` property
    // in the option object, for the editor's value when the option
    // was enabled.
    readonly version: number,
    // The local steps that havent been successfully sent to the
    // server yet.
    readonly unconfirmed: readonly Rebaseable[],

    public commit?: Commit
  ) {}

  /**
   * Create a commit from a slice of unconfirmed steps.
   * Assign a unique ref and ensure this commit is always returned
   * from the same document state.
  */
  getCommit(size: number = 20) {
    if (this.commit) return this.commit

    if (this.unconfirmed.length == 0) return null

    return this.commit = new Commit(
      this.version,
      randomRef(),
      // neutralizeSteps(this.unconfirmed.slice(0, size).map(r => r.step))
      this.unconfirmed.slice(0, size).map(r => r.step)
    )
  }
}

export function unconfirmedFrom(transform: Transform) {
  let result = []
  for (let i = 0; i < transform.steps.length; i++)
    result.push(new Rebaseable(transform.steps[i],
                               transform.steps[i].invert(transform.docs[i]),
                               transform))
  return result
}

export const collabKey = new PluginKey<CollabState>("collab")

type CollabConfig = {
  /// The starting version number of the collaborative editing.
  /// Defaults to 0.
  version?: number

  /// This client's ID, used to distinguish its changes from those of
  /// other clients. Defaults to a random 32-bit number.
  clientID?: number | string
}

/// Creates a plugin that enables the collaborative editing framework
/// for the editor.
export function collab(config: CollabConfig = {}): Plugin {
  let conf: Required<CollabConfig> = {
    version: config.version || 0,
    clientID: config.clientID == null ? Math.floor(Math.random() * 0xFFFFFFFF) : config.clientID
  }

  return new Plugin({
    key: collabKey,

    state: {
      init: () => new CollabState(conf.version, []),
      apply(tr, collab) {
        let newState = tr.getMeta(collabKey)
        if (newState)
          return newState
        if (tr.docChanged)
          return new CollabState(
            collab.version,
            collab.unconfirmed.concat(unconfirmedFrom(tr)),
            collab.commit
          )
        return collab
      }
    },

    config: conf,

    // This is used to notify the history plugin to not merge steps,
    // so that the history can be rebased.
    historyPreserveItems: true
  })
}

// Initialize existing state.
export function initCollabState(state: EditorState, version: number, doc: NodeJSON) {
  const newCollabState = new CollabState(version, [])
  const content = Node.fromJSON(state.schema, doc)

  const tr = state.tr
  tr.replaceWith(0, state.doc.content.size, content)
  tr.setMeta("addToHistory", false).setMeta(collabKey, newCollabState)
  return tr
}

export function receiveCommitTransaction(
  state: EditorState,
  commit: Commit,
  options?: {
    mapSelectionBackward?: boolean
  }
) {
  let collabState = collabKey.getState(state) as CollabState

  const tr = state.tr
  tr.setMeta(collabKey, collabState)

  return chainCommitTransaction(state, tr, commit, options)
}

export function chainCommitTransaction(
  state: EditorState,
  tr: Transaction,
  commit: Commit,
  options?: {
    mapSelectionBackward?: boolean
  }
) {
  let collabState = tr.getMeta(collabKey) as CollabState
  let { nextVersion, unconfirmed = [], commit: uncommited } = collabState
  const nUnconfirmed = unconfirmed.length

  if (nextVersion != commit.version) return tr

  if (commit.ref == uncommited?.ref) {
    return tr.setMeta(collabKey, new CollabState(nextVersion, unconfirmed.slice(commit.steps.length)))
  }

  unconfirmed = rebaseSteps(unconfirmed, commit.steps, tr)

  const newCollabState = new CollabState(
    nextVersion,
    unconfirmed,
    uncommited
  )

  if (options?.mapSelectionBackward && state.selection instanceof TextSelection) {
    tr.setSelection(TextSelection.between(tr.doc.resolve(tr.mapping.map(state.selection.anchor, -1)),
                                          tr.doc.resolve(tr.mapping.map(state.selection.head, -1)), -1))
    ;(tr as any).updated &= ~1
  }
  return tr.setMeta("rebased", nUnconfirmed).setMeta("addToHistory", false).setMeta(collabKey, newCollabState)
}

export function sendableCommit(state: EditorState): Commit | null {
  let collabState = collabKey.getState(state) as CollabState
  return collabState.getCommit()
}

/// Get the version up to which the collab plugin has synced with the
/// central authority.
export function getVersion(state: EditorState) {
  return collabKey.getState(state)?.version
}

export function randomRef() {
  let bytes = new Uint32Array(2);

  if (typeof window !== 'undefined')
    window.crypto.getRandomValues(bytes)
  else
    globalThis.crypto.getRandomValues(bytes)

  return bytes.reduce((str, byte) => str + byte.toString(36), "");
}