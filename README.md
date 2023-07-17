prosemirror-collab-commit
=========================

Commit-based collaborative editing plugin for ProseMirror.



## Usage

Abridged usage examples that should be familar to those who have used `prosemirror-collab`.

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