# Contacts REST sunset (import island)

Source: ad-hoc

Chunk C of the JMAP REST sunset: lift dual-protocol contacts REST Feature
asserts onto AddressBook/* and ContactCard/* envelope methods, then delete
`/contacts/*` except `POST /contacts/cards/import`. CardDAV, import, and
`AddressBookRepository` / `ContactCardRepository` stay.
