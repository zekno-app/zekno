# Feature Specification: Core Library

**Feature Branch**: `002-core-library`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Core library (`packages/core`): the one place where keys are generated, secrets are encrypted, deploys are signed and verified, and team membership is proven. It is shared by every client (first the CLI, later the desktop app) and by the server agent, so both sides encrypt and verify in exactly the same way. It must settle the design questions the architecture flows exposed: how keys are confirmed when a server is connected, who vouches for a new teammate, and how replayed deploys are refused. The control plane is treated as untrusted: a full breach of it must yield no secrets and no ability to run code on a customer's server."

## Clarifications

### Session 2026-11-13

Each point below was first resolved with a documented default taken from the README, the design rules, or the architecture flows discussed on 2026-11-13. The maintainer then confirmed the four decisions marked "confirmed" on 2026-11-13, and asked for signed secret removals to be built.

- Q: Are the three open design decisions (key confirmation at pairing, vouching for teammates, replay protection) part of this feature? → A: Yes. The maintainer was told they belong in the core design before any client is written, and then asked for the core feature.
- Q: Can a team member read a secret back after setting it? → A: No (confirmed). A secret is encrypted for one server only, as the README states. To change it, a member sets a new value.
- Q: Does the library store keys (keychain, files)? → A: No. Storage belongs to each client. The library accepts and returns key material and never writes it anywhere.
- Q: Does the library talk to the network? → A: No. It defines the shapes of the messages exchanged with the control plane; sending them belongs to the clients and the agent.
- Q: Which roles can sign what? → A: Two roles (confirmed). An admin can change the team and authorize deploys. A deployer can only authorize deploys. People who only view status hold no key and are not part of this library.
- Q: Must a client and a server be on the same team list for a deploy to be accepted? → A: Yes (confirmed). A server only accepts deploys built from the team list it currently holds.
- Q: What happens to secrets set by a member who is later removed? → A: They stop passing verification and must be set again by a current member (confirmed).
- Q: How does the team retire a secret so the control plane cannot offer it again? → A: A member signs a removal. Clients leave the secret out and carry the removal to the server, which then refuses the old record.
- Q: Does the library protect against the control plane withholding deploys or team changes? → A: No. Withholding is a denial of service that signatures cannot prevent. It is recorded as a limit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A deploy only the team can authorize and only the server can read (Priority: P1)

A developer sets secrets for an app and deploys it to a server the team owns. On their machine the secrets are encrypted for that one server and the deploy is signed with the developer's key. The server's agent receives the deploy through an untrusted relay, checks who signed it, and only then decrypts the secrets and hands the deploy over to be run.

**Why this priority**: this is the product's whole promise. Without it nothing else in the library has a purpose.

**Independent Test**: create a team with one member and one server, seal two secrets, sign a deploy, verify it as the agent and open the secrets. The agent recovers the exact values; a party holding everything except the server's private key recovers nothing.

**Acceptance Scenarios**:

1. **Given** a team member and a connected server, **When** the member seals secrets and signs a deploy, **Then** the agent accepts it and recovers every secret value exactly.
2. **Given** everything the relay stored for that deploy, **When** someone without the server's private key tries to open a secret, **Then** they fail and learn nothing but the size of the encrypted value.
3. **Given** a deploy signed by a key the team never approved, **When** the agent checks it, **Then** it is refused before any secret is decrypted, with a reason the agent can report.
4. **Given** a deploy that was altered by one byte after signing, **When** the agent checks it, **Then** it is refused.
5. **Given** the agent's interface, **When** a caller tries to decrypt secrets for a deploy that has not passed verification, **Then** there is no way to do so.

---

### User Story 2 - A breached relay cannot replay, redirect or swap anything (Priority: P2)

An attacker controls the relay completely. They hold every deploy the team ever signed and every encrypted secret. They try to make a server run an old deploy again, run a deploy meant for another server, or pair one secret's encrypted value with another secret's name.

**Why this priority**: valid signatures alone do not stop these attacks, and each one turns a "breach finds nothing" claim into a false one.

**Independent Test**: record a sequence of genuine deploys, then present them to the agent out of order, to the wrong server, and with encrypted values exchanged. Every attempt is refused with a distinct reason.

**Acceptance Scenarios**:

1. **Given** the agent has accepted deploy number 5 for an app, **When** it is offered the genuine, validly signed deploy number 3, **Then** it refuses it as a replay.
2. **Given** the team wants the old version back, **When** a member signs a new deploy that carries the old content with the next number, **Then** the agent accepts it.
3. **Given** a deploy signed for server A, **When** it is offered to server B of the same team, **Then** server B refuses it.
4. **Given** a deploy with secrets `DATABASE_URL` and `PUBLIC_URL`, **When** the relay exchanges their encrypted values, **Then** the agent refuses the deploy.
6. **Given** the relay offers a client an encrypted value it produced itself as one of the team's secrets, **When** the client builds a deploy, **Then** the value is rejected before anything is signed.
7. **Given** the team rotated a secret, **When** the relay later serves the old genuine value and a member signs a deploy with it, **Then** an agent that has accepted the newer version refuses the deploy.
8. **Given** the team retired a secret and a server has received the removal, **When** the relay offers the old genuine record again and a member signs a deploy with it, **Then** the agent refuses the deploy.
9. **Given** a removal no team member signed, **When** a client works out the current secrets, **Then** the removal is ignored and reported, and no secret is dropped because of it.
5. **Given** a deploy from another team, **When** it is offered to this team's server, **Then** it is refused.

---

### User Story 3 - Team membership the relay cannot forge (Priority: P3)

An admin adds a teammate. The teammate creates their own key on their own machine, and the admin approves it with a signature. Servers accept the new teammate's deploys from then on. Later the admin removes someone, and servers stop accepting that person's deploys. The relay carries these changes but cannot invent, undo or reorder them.

**Why this priority**: if the relay decides who is on the team, a breach lets the attacker add themselves and sign deploys. This is the difference between a team product and a single-user tool, but a single member can already deploy without it.

**Independent Test**: start a team, add a member, remove a member, and present servers with forged and out-of-order membership changes. Only changes signed by a current admin, in order, are accepted.

**Acceptance Scenarios**:

1. **Given** a team with one admin, **When** the admin approves a new deployer, **Then** servers accept the membership change and then accept deploys signed by the new deployer.
2. **Given** a membership change that no current admin signed, **When** a server receives it, **Then** the server keeps its current team list and refuses the change.
3. **Given** a deployer, **When** they sign a membership change, **Then** it is refused, because only admins change the team.
4. **Given** a member was removed in the latest change, **When** they sign a deploy, **Then** servers that have received the change refuse it.
5. **Given** a server holds team list number 4, **When** it is offered the genuine list number 3, **Then** it refuses to go back.
6. **Given** a change that would leave the team without any admin, **When** it is created or received, **Then** it is rejected.

---

### User Story 4 - Confirming keys when a server is connected (Priority: P4)

A developer connects a new server. The server's public key and the team's founding member list both travel through the relay. Before trusting either, the developer compares a short code shown on the server with the one shown on their machine. If the relay substituted a key, the codes differ.

**Why this priority**: without it a breached relay can substitute its own key at the moment of connection and read every secret set afterwards. It is needed before real use, but the mechanics of deploys can be built and tested first.

**Independent Test**: derive the short code for a key on two machines and get the same result; derive it for a different key and get a different result that a person can tell apart.

**Acceptance Scenarios**:

1. **Given** the same public key on two machines, **When** each derives its short code, **Then** the codes are identical.
2. **Given** a substituted key, **When** its short code is derived, **Then** it differs from the genuine one.
3. **Given** a short code typed by a person with different spacing or letter case, **When** it is compared with the expected one, **Then** it still matches.
4. **Given** a server at first connection, **When** it is given a founding member list, **Then** it records that list as its starting point only if its short code was confirmed by the person connecting it.

---

### User Story 5 - One description of every message, shared by all parties (Priority: P5)

The CLI, the agent and the control plane are built by different people in different repositories. Each needs the same definition of what a signed deploy, a membership change, an encrypted secret and a status report look like, and each must reject anything that does not fit.

**Why this priority**: it removes a class of mismatch bugs and is the public record of exactly what the hosted service receives. It can be finalised last because the earlier stories define the shapes.

**Independent Test**: a message produced by one party is accepted by another using only the shared definitions, and a message with an unknown field, a missing field or an oversized field is rejected.

**Acceptance Scenarios**:

1. **Given** a message built with the shared definitions, **When** another party reads it, **Then** it gets the same content.
2. **Given** a message with an unexpected extra field, **When** it is read, **Then** it is rejected.
3. **Given** a message larger than the stated limit, **When** it is read, **Then** it is rejected before its content is processed.
4. **Given** a message marked with a format version this library does not know, **When** it is read, **Then** it is rejected with a reason that says so.

---

### Edge Cases

- A secret name appears twice in one deploy: the deploy cannot be created and is refused if received.
- A deploy lists a secret whose encrypted value is missing, or an encrypted value arrives that the deploy does not list: refused.
- A deploy has no secrets at all: valid.
- The first deploy ever for an app: any number of 1 or more is accepted, and that number becomes the floor.
- Two members sign deploys with the same number: the first one the agent accepts wins; the second is refused as a replay and its author must sign again with a higher number.
- A member holds a valid key but the server has not yet received the membership change that adds them: their deploy is refused until the change arrives.
- A key of the wrong kind is supplied (an encryption key where a signing key is expected): rejected by its marking, never silently misused.
- A value that is not valid text, a name with characters outside the allowed set, or a size over the limit: rejected when the secret is sealed.
- Garbage, truncated or empty input anywhere a message is expected: rejected with a reason, never an unhandled failure.
- The same membership change is delivered twice: the second delivery is refused as already applied and changes nothing.

## Requirements *(mandatory)*

### Functional Requirements

**Keys**

- **FR-001**: The library MUST generate a signing key pair for a team member and an encryption key pair for a server, using a source of randomness suitable for keys.
- **FR-002**: Every key MUST carry a marking of its kind (member signing or server encryption, public or private) in its text form, and the library MUST reject a key of the wrong kind wherever a key is accepted.
- **FR-003**: The library MUST derive a stable identifier from a public key, used to name the signer of a message.
- **FR-004**: The library MUST NOT write key material to disk, logs or error messages. Private keys MUST be accepted from and returned to the caller only.
- **FR-005**: Signing MUST be possible through a caller-supplied signer, so a client can keep the private key in the operating system's keychain or a hardware device and the library never needs to hold it.

**Secrets**

- **FR-006**: The library MUST encrypt a secret so that only the holder of one server's private key can read it, without the sender needing any long-term private key.
- **FR-007**: An encrypted secret MUST be bound to its name, its app and its server, so that it cannot be opened under a different name, app or server.
- **FR-008**: Secret names MUST match the environment-variable convention (letters, digits and underscore, not starting with a digit), and names and values MUST have stated size limits.
- **FR-009**: Decryption MUST fail closed: any tampering with the encrypted value yields an error and no partial content.
- **FR-029**: Every secret MUST carry a team member's signed statement binding its encrypted value to the team, server, app, name and a version number. Creating a deploy MUST verify that statement for every secret, so an encrypted value the control plane produced itself cannot enter a deploy a member signs. *(Added 2026-11-13 from the security review.)*
- **FR-030**: A deploy MUST state the version of each secret, and the agent MUST refuse a deploy that carries an older version of a secret than one it has already accepted, or a different encrypted value under the same version. *(Added 2026-11-13 from the security review.)*
- **FR-031**: The public keys of a team's servers MUST be part of the admin-signed team list. Sealing a secret and creating a deploy MUST take the server's key from that list only, so a key the control plane supplies is never used. An agent MUST refuse deploys when its own server is not in the team list it holds. *(Added 2026-11-13 from the security review.)*
- **FR-032**: The team's confirmation code MUST be derivable from the trust a member already holds, at any version of the team list, without fetching anything from the control plane. *(Added 2026-11-13 from the security review.)*
- **FR-033**: A deploy MUST name the team list it was built from, and the agent MUST refuse a deploy built from a different list than the one it holds. *(Added 2026-11-13 from the security review.)*
- **FR-034**: The agent MUST refuse a deploy number more than a fixed step above the last one accepted for the app, and MUST treat incomplete or damaged stored state as an error. *(Added 2026-11-13 from the security review.)*
- **FR-035**: A member MUST be able to sign a removal of a secret, numbered one above the secret's current version. The library MUST work out an app's current secrets from the records and removals a client was given, verifying each, taking the highest version of each name, leaving out removed names and reporting anything it ignored. A deploy MUST be able to carry removals, and the agent MUST remember a removal as the latest version of that name, so an earlier record of it is refused. *(Added 2026-11-13 at the maintainer's request.)*

**Deploys**

- **FR-010**: The library MUST build a deploy description containing the team, the target server, the app, a deploy number, the creation time, the service definition to run, and for each secret its name and a fingerprint of its encrypted value.
- **FR-011**: The library MUST sign a deploy description with a member's key so that any change to it after signing is detected.
- **FR-012**: A signature made for one kind of message MUST NOT be accepted for another kind (a signed deploy can never be passed off as a membership change, or the reverse).
- **FR-013**: The agent-side check MUST refuse a deploy unless all of the following hold: the signature is valid; the signer is a current team member whose role allows deploys; the team and server match the agent's own; the deploy number is higher than the last one accepted for that app; and the encrypted values supplied match the fingerprints in the description exactly, with none missing and none extra.
- **FR-014**: The agent-side check MUST return the specific reason for a refusal from a fixed list, so the agent can report it.
- **FR-015**: Secrets MUST only be decryptable through the result of a successful check. The library MUST NOT offer a way to decrypt a deploy's secrets that skips the check.
- **FR-016**: After a deploy is accepted, the library MUST give the agent the new state to remember (the last accepted number for that app), and MUST NOT keep state itself.

**Team**

- **FR-017**: The library MUST represent a team as a numbered list of members and servers. Each member has a public key, a display name and a role (admin or deployer); each server has a public key and a display name. Display names MUST NOT contain control, invisible or direction-changing characters.
- **FR-018**: A team MUST start with a founding list signed by its first admin. Each later list MUST be numbered one higher than the list it replaces, refer to that list by fingerprint, and be signed by a member who is an admin in the list it replaces.
- **FR-019**: The library MUST refuse a member list that is not signed by a current admin, that skips or repeats a number, that does not refer to the current list, that belongs to another team, that contains the same key twice, or that has no admin.
- **FR-020**: The library MUST produce a fingerprint of a founding list for use in the confirmation of User Story 4, and a server MUST be able to start from a founding list only through an explicit "this was confirmed" step.

**Confirmation codes**

- **FR-021**: The library MUST derive, from a public key or a founding list, a short code a person can read aloud and compare, strong enough that an attacker cannot find a second key with the same code.
- **FR-022**: Code comparison MUST ignore letter case and separators, and MUST take the same time whether or not the codes match.

**Messages**

- **FR-023**: The library MUST publish the definitions of every message exchanged between clients, the control plane and the agent: publishing a deploy, fetching pending deploys, reporting status, publishing and fetching team changes, and registering a server's public key.
- **FR-024**: Reading any message from outside MUST validate it completely against its definition, rejecting unknown fields, wrong types, unknown format versions and oversized content, before any of its content is used.
- **FR-025**: Status reports sent by the agent MUST contain only metadata (which deploy, accepted or refused, the refusal reason, when), and MUST have no field that could carry a secret value or log output.

**Boundaries**

- **FR-026**: The library MUST contain no user-interface, framework, networking or storage code, and MUST run unchanged in the CLI, the desktop app's main process and the agent.
- **FR-027**: The library MUST use established, publicly reviewed cryptographic building blocks and MUST NOT implement a cipher, signature scheme or hash of its own.
- **FR-028**: Every refusal and every failure MUST be reported as a typed result or a typed error with a stable code. Error text MUST NOT include secret values or private key material.

### Key Entities

- **Member key**: a signing key pair owned by one person. The private half stays with that person's client.
- **Server key**: an encryption key pair owned by one server. The private half never leaves the server.
- **Team list**: the numbered, signed list of members and roles that servers trust. It forms a chain back to the founding list.
- **Encrypted secret**: one secret value encrypted for one server, bound to a name, an app and that server.
- **Deploy**: a signed description of what one server should run for one app, with a number that only goes up, and the fingerprints of the encrypted secrets that belong to it.
- **Agent state**: what a server remembers between deploys: its own identity, the current team list, and the last accepted deploy number for each app. The agent stores it; the library reads and returns it.
- **Confirmation code**: a short human-comparable code derived from a public key or a founding list.
- **Refusal reason**: one of a fixed list of reasons a deploy or a team change was not accepted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A complete round trip (create team, connect server, seal secrets, sign, verify, open) succeeds, and every recovered secret equals the original, in an automated end-to-end scenario.
- **SC-002**: For each attack in User Stories 1 to 3 (forged, altered, replayed, redirected, exchanged values, forged or reordered team change, removed member), an automated scenario shows the attempt refused with its own distinct reason. Target: 100% of the listed attacks covered.
- **SC-003**: Nothing the relay stores for a deploy contains any secret value in readable form, checked by searching the stored bytes for each value in an automated scenario.
- **SC-004**: An agent verifies and opens a deploy with 50 secrets in under 100 milliseconds on a current laptop.
- **SC-005**: A developer new to the project can complete the round trip from the quickstart in under 10 minutes without reading the library's source.
- **SC-006**: An independent security review pass over the finished library reports no finding rated high or critical that remains open at the end of the feature.
- **SC-007**: Malformed input never produces an unhandled failure: every case in the edge-case list is rejected with a typed reason in automated tests.

## Assumptions

- The control plane is untrusted for confidentiality and integrity. It is trusted only to eventually deliver what it is given; withholding is a recorded limit.
- A team member's machine and each server are trusted. A compromised member machine or server is outside what this library can protect, as the README already states.
- Metadata is visible to the control plane: team and server identifiers, app names, secret names, deploy numbers and times, sizes of encrypted values, and the service definition of each deploy. Hiding the service definition from the control plane is out of scope for this feature.
- Servers have clocks that may be wrong. No security decision depends on time; creation times are informational.
- The service definition is carried as text and is not interpreted by this library.
- One deploy targets one server and one app.
- Key storage, key backup and recovery from a lost machine are client features and out of scope.
- Deploys signed from CI, approval by two people, and reading secrets back are out of scope.
- A removal protects a server once that server has received it in a deploy. If the control plane withholds the removal from every client that deploys, the removal has not taken effect there; that is the withholding limit above.
- The design has not been independently audited. The security review in this feature is an internal pass, not a substitute for an external audit before production use.
