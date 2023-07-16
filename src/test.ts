import crypto from 'crypto'

Object.defineProperty(globalThis, 'crypto', {
    value: crypto
})