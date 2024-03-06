prosemirror-collab-commit
=========================

> [!NOTE]
> This project is *not* dead. ProseMirror's core packages change extremely infrequently including bug fixes.

Commit-based collaborative editing plugin for ProseMirror.

This solves two key problems with `prosemirror-collab` through server-side
rebasing without the use of CRDTs:

1. **Throughput**: 200 active clients per 1s of commit delay is feasible
   depending on backend implementation and edit characteristics.
2. **Fairness**: Users with high latencies will not have their edits blocked by
   users with low latencies. This will **greatly smooth the collab experience** on
   documents with high levels of concurrent edits.

## How it works

The performance issues with `prosemirror-collab` and how this plugin solves them
are written about in [ProseMirror Collab Performance](https://stepwisehq.com/blog/2023-07-25-prosemirror-collab-performance/).

## Usage

Abridged usage examples that should be familar to those who have used `prosemirror-collab`.

As with `prosemirror-collab` the actual backend implementation is left to the
developer. `TODO: Implement` indicates code the implementor must write.

**Client Send Commit**

```typescript
import { collab, sendableCommit } from "@stepwisehq/prosemirror-collab-commit/collab-commit"

const state = EditorState.create({schema}, {plugins: [collab()]})

//Some edits later...

const commit = sendableCommit(state)
await sendCommitToServer(commit.toJSON()) // TODO: Implement
```

**Client Receive Commit**

```typescript
import { receiveCommitTransaction } from "@stepwisehq/prosemirror-collab-commit/collab-commit"

//...

const commitJson = await fetchNextCommitFromServer() // TODO: Implement
const commit = Commit.FromJSON(state.schema, commitJson)
const tr = receiveCommitTransaction(state, commit)
state = state.apply(tr)
```


**Authority Map Commit**

```typescript
import { applyCommitJSON } from "@stepwisehq/prosemirror-collab-commit/apply-commit"

const newCommitJson = await getCommitsFromClient() // TODO: Implement

const version = await getDocumentVersion() // TODO: Implement
const doc = await getDocument() // TODO: Implement
const newCommits = await getDocumentCommitsSince(commitJson.version) // TODO: Implement
const schemaSpec = await getSchemaSpec() // TODO: Implement

const schema = new Schema(schemaSpec)

const {docJson, commitJson} = applyCommitJSON(version, schema, doc, newCommits, newCommitJson)

await saveDocument(docJson) // TODO: Implement
await broadcastCommit(commitJson) // TODO: Implement
```
