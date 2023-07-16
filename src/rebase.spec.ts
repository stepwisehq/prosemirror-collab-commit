import { describe, it, expect } from '@jest/globals'
import './test.js'

import { EditorState, Transaction } from "prosemirror-state"
import { schema } from "prosemirror-test-builder"
import { neutralizeSteps, randomRef } from './collab-commit.js'
import { schemaSerialize, schemaToJson } from './apply-commit.js'


function type(s: EditorState, text: string, pos?: number) {
    return s.apply(s.tr.insertText(text, pos == null ? s.selection.head : pos))
}

function withTr(s: EditorState, f: (tr: Transaction) => Transaction) {
    return f(s.tr)
}

function typeTr(tr: Transaction, text: string, pos?: number) {
    return tr.insertText(text, pos == null ? tr.selection.head : pos)
}

describe('Neutralize Steps', () => {
    it('Neutralizes Steps', () => {
        let s = EditorState.create({schema})
        const tr = s.tr
        typeTr(tr, 'a')
        typeTr(tr, 'bc')
        typeTr(tr, 'd')

        const neutral = neutralizeSteps(tr.steps)

        neutral.forEach(s => expect(s).toMatchObject({from: 1}))
    })
})

describe('randomRef', () => {
    it('Makes random refs', () => {
        console.log(randomRef())
    })
})