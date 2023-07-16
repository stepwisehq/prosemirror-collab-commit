import {inspect} from 'util'
import { describe, it, expect } from '@jest/globals'
import crypto from 'crypto'

import {EditorState, Selection, Plugin, Transaction} from "prosemirror-state"
import {history, undo, redo, closeHistory} from "prosemirror-history"
import {Node, Schema} from "prosemirror-model"
import {Mapping, Step} from "prosemirror-transform"
import {schema, eq, doc, p} from "prosemirror-test-builder"

import {collab, Commit, receiveCommitTransaction, sendableCommit} from "./collab-commit.js"
import { applyCommitJSON, schemaSerialize, schemaToJson } from './apply-commit.js'

const histPlugin = history()

Object.defineProperty(globalThis, 'crypto', {
  value: crypto
})

class DummyServer {
  state: EditorState
  states: EditorState[] = []
  plugins: Plugin[] = []
  steps: Step[] = []
  commits: Commit[] = []
  clientIDs: number[] = []
  delayed: number[] = []

  refs: Set<string> = new Set()

  constructor(doc?: Node, n = 2) {
    /** Use a schema that has undergone serialization for the server */
    const myState = JSON.parse(schemaSerialize(schema))
    const useSchema = new Schema(myState)
    this.state = EditorState.create({doc, schema: useSchema})

    /** Create client node states */
    for (let i = 0; i < n; i++) {
      let plugin = collab()
      this.plugins.push(plugin)
      this.states.push(EditorState.create({doc, schema, plugins: [histPlugin, plugin]}))
    }
  }

  /** Apply server changes to node. */
  sync(n: number) {
    let state = this.states[n], version = this.plugins[n].getState(state).version

    if (version != this.commits.length) {
      const commits = this.commits.slice(version)

      commits.forEach(c => {
        const commit = c.toSchema(this.states[n].schema)
        const tr = receiveCommitTransaction(state, commit)
        state = this.states[n] = this.states[n].apply(tr)
      })
    }
  }

  /**
   * Send sendable commit from node to server.
   * IF sendable-steps are next steps then store them on the server.
  */
  send(n: number) {
    let commit = sendableCommit(this.states[n])

    if (commit) {
      if (this.refs.has(commit?.ref)) {
        return
      }

      const schemaSpec = JSON.parse(JSON.stringify(schemaToJson(this.state.schema)))
      const schema = new Schema(schemaSpec)

      const {commitJSON: appliedCommitJSON} = applyCommitJSON(
        this.commits.length,
        schema,
        this.state.doc.toJSON(),
        this.commits.slice(commit.version).map(c => c.toJSON()),
        commit.toJSON())

      const appliedCommit = Commit.FromJSON(this.state.schema, appliedCommitJSON)

      const tr = this.state.tr

      appliedCommit.steps.forEach(s => tr.step(s))

      this.state = this.state.apply(tr)

      this.commits.push(appliedCommit)
      this.refs.add(commit.ref)
    }
  }

  /**
   * Apply server changes to node.
   * Then send node changes back to server.
   * Then send server changes back to all other nodes.
   * Skip if node is delayed.
  */
  broadcast(n: number) {
    if (this.delayed.indexOf(n) > -1) return
    this.send(n)
    for (let i = 0; i < this.states.length; i++) {
      this.sync(i)
    }
  }

  update(n: number, f: (state: EditorState) => Transaction) {
    this.states[n] = this.states[n].apply(f(this.states[n]))
    this.broadcast(n)
  }

  type(n: number, text: string, pos?: number) {
    this.update(n, s => s.tr.insertText(text, pos == null ? s.selection.head : pos))
  }

  undo(n: number) {
    undo(this.states[n], tr => this.update(n, () => tr))
  }

  redo(n: number) {
    redo(this.states[n], tr => this.update(n, () => tr))
  }

  /** Assert all nodes have converged on supplied state. */
  conv(d: Node | string) {
    if (typeof d == "string") d = doc(p(d))
    for (let i = 0; i < this.states.length; i++) {
      this.broadcast(i)
    }
    this.states.forEach(state => expect(state.doc).toEqual(d))
  }

  /** Delay broadcast from supplied node until after supplied function completes. */
  delay(n: number, f: () => void) {
    this.delayed.push(n)
    f()
    this.delayed.pop()
    this.broadcast(n)
  }
}

function sel(near: number) {
  return (s: EditorState) => s.tr.setSelection(Selection.near(s.doc.resolve(near)))
}

describe("collab-commit", () => {
  it("converges for simple changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.type(1, "ok", 3)
    s.type(0, "!", 5)
    s.type(1, "...", 1)
    s.conv("...hiok!")
  })

  it("converges for multiple local changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.delay(0, () => {
      s.type(0, "A")
      s.type(1, "X")
      s.type(0, "B")
      s.type(1, "Y")
    })
    s.conv("hiXYAB")
  })

  it("converges with delayed confirmation", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.delay(0, () => {
      s.type(0, "A")
      /** Send now to create and unconfirmed commit in node 0 collab state */
      s.send(0)
      s.type(1, "X")
      s.type(0, "B")
      s.type(1, "Y")
    })
    s.conv("hiAXYB")
  })

  it("converges with three peers", () => {
    let s = new DummyServer(undefined, 3)
    s.type(0, "A")
    s.type(1, "U")
    s.type(2, "X")
    s.type(0, "B")
    s.type(1, "V")
    s.type(2, "C")
    s.conv("AUXBVC")
  })

  it("converges with three peers with multiple steps", () => {
    let s = new DummyServer(undefined, 3)
    s.type(0, "A")
    s.delay(1, () => {
      s.type(1, "U")
      s.type(2, "X")
      s.type(0, "B")
      s.type(1, "V")
      s.type(2, "C")
    })
    s.conv("AXBCUV")
  })

  it("supports undo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "B")
    s.type(0, "C")
    s.undo(1)
    s.conv("AC")
    s.type(1, "D")
    s.type(0, "E")
    s.conv("ACDE")
  })

  it("supports redo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "B")
    s.type(0, "C")
    s.undo(1)
    s.redo(1)
    s.type(1, "D")
    s.type(0, "E")
    s.conv("ABCDE")
  })

  it("supports deep undo", () => {
    let s = new DummyServer(doc(p("hello"), p("bye")))
    s.update(0, sel(6))
    s.update(1, sel(11))
    s.type(0, "!")
    s.type(1, "!")
    s.update(0, s => closeHistory(s.tr))
    s.delay(0, () => {
      s.type(0, " ...")
      s.type(1, " ,,,")
    })
    s.update(0, s => closeHistory(s.tr))
    s.type(0, "*")
    s.type(1, "*")
    s.undo(0)
    s.conv(doc(p("hello! ..."), p("bye! ,,,*")))
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("hello"), p("bye! ,,,*")))
    s.redo(0)
    s.redo(0)
    s.redo(0)
    s.conv(doc(p("hello! ...*"), p("bye! ,,,*")))
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("hello!"), p("bye! ,,,*")))
    s.undo(1)
    s.conv(doc(p("hello!"), p("bye")))
  })

  it("support undo with clashing events", () => {
    let s = new DummyServer(doc(p("hello")))
    s.update(0, sel(6))
    s.type(0, "A")
    s.delay(0, () => {
      s.type(0, "B", 4)
      s.type(0, "C", 5)
      s.type(0, "D", 1)
      s.update(1, s => s.tr.delete(2, 5))
    })
    s.conv("DhoA")
    s.undo(0)
    s.undo(0)
    s.conv("ho")
    expect(s.states[0].selection.head).toEqual(3)
  })

  it("handles conflicting steps", () => {
    let s = new DummyServer(doc(p("abcde")))
    s.delay(0, () => {
      s.update(0, s => s.tr.delete(3, 4))
      s.type(0, "x")
      s.update(1, s => s.tr.delete(2, 5))
    })
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("ae")))
  })

  it("can undo simultaneous typing", () => {
    let s = new DummyServer(doc(p("A"), p("B")))
    s.update(0, sel(2))
    s.update(1, sel(5))
    s.delay(0, () => {
      s.type(0, "1")
      s.type(0, "2")
      s.type(1, "x")
      s.type(1, "y")
    })
    s.conv(doc(p("A12"), p("Bxy")))
    s.undo(0)
    s.conv(doc(p("A"), p("Bxy")))
    s.undo(1)
    s.conv(doc(p("A"), p("B")))
  })
})