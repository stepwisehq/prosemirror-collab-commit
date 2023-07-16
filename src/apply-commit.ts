import { Schema, Node, SchemaSpec } from "prosemirror-model"
import { Mapping, Step, Transform } from "prosemirror-transform"
import { Commit, CommitJSON, NodeJSON } from "./collab-commit.js"

/**
 * Maps a JSON commit forward through commits newer than commit version. Attempts to apply steps and drops
 * any that fail. This version takes all plain JSON arguments.
 * @param version Current document version
 * @param schema Document schema
 * @param doc Current document
 * @param commitsJSON Commits since the commit base version
 * @param commitJSON Commit to apply forward
 * @returns New doc and mapped commit with the version set to next and steps mapped forward.
 */
export function applyCommitJSON(version: number, schema: Schema, docJSON: NodeJSON, commitsJSON: CommitJSON[], commitJSON: CommitJSON) {
    const doc = Node.fromJSON(schema, docJSON)

    const commits = commitsJSON.map(c => Commit.FromJSON(schema, c))
    const newSteps = commits.reduce((steps, c) => steps = steps.concat(c.steps), [] as Step[])
    const newStepMap = new Mapping(newSteps.map(s => s.getMap()))

    const commit = Commit.FromJSON(schema, commitJSON)
    const commitSteps = commit.steps
    const mapping = new Mapping(commitSteps.map(s => s.getMap())).invert()
    mapping.appendMapping(newStepMap)

    const tr = new Transform(doc)

    for (let i = 0, mapFrom = commitSteps.length; i < commitSteps.length; i++) {
      const step = commitSteps[i]
      const sliced = mapping.slice(mapFrom)
      const mapped = step!.map(sliced)!
      mapFrom--
      if (mapped && !tr.maybeStep(mapped).failed) {
        mapping.appendMapping(new Mapping(tr.mapping.maps.slice(tr.steps.length - 1)))
        // Set mirror so positions can be recovered properly. Without this a Replace.To
        // that landed in a position created by a predecessor would not get mapped back to the correct
        // position.
        // @ts-ignore
        mapping.setMirror(mapFrom, mapping.maps.length - 1)
      }
    }

    version++
    const appliedCommit = new Commit(version, commit.ref, tr.steps)

    return {
      docJSON: tr.doc.toJSON() as NodeJSON,
      commitJSON: appliedCommit.toJSON()
    }
}

export function schemaToJson(schema: Schema) {
    const spec = {
        nodes: {} as {[key: string]: any},
        marks: {} as {[key: string]: any},
      }

    schema.spec.nodes.forEach((key, value) => spec.nodes[key] = value)
    schema.spec.marks.forEach((key, value) => spec.marks[key] = value)

    return spec as SchemaSpec
}

export function schemaSerialize(schema: Schema) {
    return JSON.stringify(schemaToJson(schema))
}