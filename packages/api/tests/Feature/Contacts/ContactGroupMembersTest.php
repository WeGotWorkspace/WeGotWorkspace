<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Dav\Server\PropIdEnsuringPlugin;
use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\MemberUriSanitizer;
use App\Services\Contacts\PropIdEnsurer;
use Illuminate\Support\Facades\Artisan;
use Sabre\HTTP\Request;
use Sabre\HTTP\Response;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class ContactGroupMembersTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_apple_style_group_members_resolve_to_member_card_ids(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $janeId = $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
END:VCARD
VCARD);

        $joeId = $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:07d442ce-49b5-4a59-bc01-d75b17b92c9a
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $card = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $card['kind'] ?? null);
        $this->assertSame($janeId, $card['memberCardIds']['urn:uuid:'.$janeUid] ?? null);
        $this->assertSame($joeId, $card['memberCardIds']['urn:uuid:'.$joeUid] ?? null);
    }

    public function test_carddav_put_adding_group_member_persists(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';
        $newUid = 'a9c0941e-ddf9-4c98-a1da-ee1b241a7e2d';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $this->seedCardViaPdo('bob', 'new-contact.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:New Contact
UID:{$newUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        // Simulate Apple Contacts.app updating the group vCard after adding a member.
        $this->updateCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$joeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$newUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->ensurePropIdsOnStoredCard('bob', 'friends-group.vcf');

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$joeUid, $raw);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$newUid, $raw);

        $card = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $card['kind'] ?? null);
        $this->assertCount(3, $card['members'] ?? []);
        $this->assertCount(3, $card['memberCardIds'] ?? []);
    }

    public function test_rest_name_patch_after_carddav_member_add_preserves_members(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $stale = $this->jmapGetContactCard($groupId);
        $staleState = (string) ($stale['state'] ?? '');

        $this->updateCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$joeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'ifInState' => $staleState,
                'name' => [
                    '@type' => 'Name',
                    'isOrdered' => false,
                    'full' => 'Close Friends',
                ],
            ]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$groupId.'.type', 'stateMismatch');

        $current = $this->jmapGetContactCard($groupId);
        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'ifInState' => (string) ($current['state'] ?? ''),
                'name' => [
                    '@type' => 'Name',
                    'isOrdered' => false,
                    'full' => 'Close Friends',
                ],
            ]]], 'c0'],
        ])->assertOk();

        $patched = $this->jmapGetContactCard($groupId);
        $this->assertSame('Close Friends', $patched['name']['full'] ?? null);
        $this->assertCount(2, $patched['members'] ?? []);
        $this->assertCount(2, $patched['memberCardIds'] ?? []);
    }

    public function test_macos_corrupt_group_members_resolve_to_member_card_ids(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $janeId = $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $joeId = $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:"urn:uuid:{$janeUid}"
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:"urn:uuid:{$joeUid}"
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $card = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $card['kind'] ?? null);
        $this->assertSame($janeId, $card['memberCardIds']['urn:uuid:'.$janeUid] ?? null);
        $this->assertSame($joeId, $card['memberCardIds']['urn:uuid:'.$joeUid] ?? null);
    }

    public function test_carddav_put_sanitizes_macos_corrupt_group_member_uris(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->updateCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:"urn:uuid:{$janeUid}"
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->ensurePropIdsOnStoredCard('bob', 'friends-group.vcf');

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$janeUid, $raw);
        $this->assertStringNotContainsString('"urn:uuid:', $raw);

        $card = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $card['kind'] ?? null);
        $this->assertCount(1, $card['memberCardIds'] ?? []);
    }

    public function test_carddav_get_sanitizes_corrupt_group_member_uris_without_persisting(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $corrupt = <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:"urn:uuid:{$janeUid}"
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD;

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', $corrupt);

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $etagBefore = (string) $stored->etag;
        $rawBefore = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;

        $plugin = new PropIdEnsuringPlugin(
            new PropIdEnsurer,
            new MemberUriSanitizer,
            PropIdEnsuringPlugin::cardBackendFromConnection(),
        );
        $request = new Request('GET', '/addressbooks/bob/default/friends-group.vcf');
        $response = new Response(200);
        $response->setBody($rawBefore);
        $plugin->afterCardMethod($request, $response);

        $body = (string) $response->getBody();
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$janeUid, $body);
        $this->assertStringNotContainsString('"urn:uuid:', $body);

        $storedAfter = $this->findBobCard($groupId);
        $this->assertNotNull($storedAfter);
        $rawAfter = is_string($storedAfter->carddata) ? $storedAfter->carddata : (string) $storedAfter->carddata;
        $this->assertSame($etagBefore, (string) $storedAfter->etag);
        $this->assertSame($rawBefore, $rawAfter);
    }

    public function test_backfill_command_sanitizes_corrupt_group_member_uris_in_database(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:"urn:uuid:{$janeUid}"
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->assertSame(0, Artisan::call('wgw:contacts:sanitize-group-member-uris'));

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$janeUid, $raw);
        $this->assertStringNotContainsString('"urn:uuid:', $raw);
    }

    public function test_patch_group_name_updates_vcard_fn_and_n(): void
    {
        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $show = $this->jmapGetContactCard($groupId);
        $this->assertSame('Friends', $show['name']['full'] ?? null);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'name' => [
                    '@type' => 'Name',
                    'isOrdered' => false,
                    'full' => 'Close Friends',
                ],
            ]]], 'c0'],
        ])->assertOk();

        $this->assertSame('Close Friends', $this->jmapGetContactCard($groupId)['name']['full'] ?? null);

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('FN:Close Friends', $raw);
        $this->assertStringContainsString('N:Close Friends', $raw);
        $this->assertStringNotContainsString('FN:Friends', $raw);
        $this->assertStringNotContainsString('N:Friends', $raw);
    }

    public function test_rest_patch_adding_group_member_persists_vcard_and_member_card_ids(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $janeId = $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $joeId = $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $show = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $show['kind'] ?? null);
        $this->assertCount(1, $show['members'] ?? []);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'members' => [
                    'urn:uuid:'.$joeUid => true,
                ],
            ]]], 'c0'],
        ])->assertOk();

        $patch = $this->jmapGetContactCard($groupId);
        $this->assertSame('group', $patch['kind'] ?? null);
        $this->assertCount(2, $patch['members'] ?? []);
        $this->assertCount(2, $patch['memberCardIds'] ?? []);
        $this->assertSame($janeId, $patch['memberCardIds']['urn:uuid:'.$janeUid] ?? null);
        $this->assertSame($joeId, $patch['memberCardIds']['urn:uuid:'.$joeUid] ?? null);

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$janeUid, $raw);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$joeUid, $raw);
    }

    public function test_rest_patch_adding_group_member_reports_updated_in_card_changes(): void
    {
        [$groupId] = $this->seedGroupWithJaneAndJoeMembers();

        $initial = $this->jmapContacts([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk();
        $state = $initial->json('methodResponses.0.1.newState');
        $this->assertNotSame('', (string) $state);

        $show = $this->jmapGetContactCard($groupId);
        $this->assertCount(1, $show['members'] ?? []);

        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'members' => [
                    'urn:uuid:'.$joeUid => true,
                ],
            ]]], 'c0'],
        ])->assertOk();

        $changes = $this->jmapContacts([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c1'],
        ])->assertOk();
        $this->assertContains($groupId, $changes->json('methodResponses.0.1.updated') ?? []);
    }

    public function test_contact_set_adding_group_member_reports_updated_in_card_changes(): void
    {
        [$groupId] = $this->seedGroupWithJaneAndJoeMembers();

        $initial = $this->jmapContacts([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk();
        $state = $initial->json('methodResponses.0.1.newState');
        $this->assertNotSame('', (string) $state);

        $show = $this->jmapGetContactCard($groupId);
        $this->assertCount(1, $show['members'] ?? []);
        $cardState = (string) ($show['state'] ?? '');
        $this->assertNotSame('', $cardState);

        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $set = $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'ifInState' => $cardState,
                'members' => [
                    'urn:uuid:'.$joeUid => true,
                ],
            ]]], 'c0'],
        ])->assertOk();
        $nextState = $set->json('methodResponses.0.1.updated.'.$groupId.'.state');
        $this->assertIsString($nextState);
        $this->assertNotSame('', $nextState);
        $this->assertNotSame($cardState, $nextState);

        $changes = $this->jmapContacts([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c1'],
        ])->assertOk();
        $this->assertContains($groupId, $changes->json('methodResponses.0.1.updated') ?? []);
    }

    public function test_rest_patch_adding_group_member_bumps_addressbook_synctoken(): void
    {
        [$groupId] = $this->seedGroupWithJaneAndJoeMembers();

        $initial = $this->jmapContacts([
            ['AddressBook/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk();
        $state = $initial->json('methodResponses.0.1.newState');
        $this->assertNotSame('', (string) $state);

        $show = $this->jmapGetContactCard($groupId);
        $this->assertCount(1, $show['members'] ?? []);

        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'members' => [
                    'urn:uuid:'.$joeUid => true,
                ],
            ]]], 'c0'],
        ])->assertOk();

        $changes = $this->jmapContacts([
            ['AddressBook/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c1'],
        ])->assertOk();
        $this->assertContains('default', $changes->json('methodResponses.0.1.updated') ?? []);
    }

    public function test_rest_patch_add_member_with_stale_etag_returns_412(): void
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';
        $newUid = 'a9c0941e-ddf9-4c98-a1da-ee1b241a7e2d';

        $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $this->seedCardViaPdo('bob', 'new-contact.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:New Contact
UID:{$newUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $stale = $this->jmapGetContactCard($groupId);

        $this->updateCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$joeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'ifInState' => (string) ($stale['state'] ?? ''),
                'members' => [
                    'urn:uuid:'.$newUid => true,
                ],
            ]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$groupId.'.type', 'stateMismatch');
    }

    /**
     * Seed Jane + Joe contacts and a Friends group with Jane as the sole member.
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function seedGroupWithJaneAndJoeMembers(): array
    {
        $janeUid = 'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f';
        $joeUid = '07d442ce-49b5-4a59-bc01-d75b17b92c9a';

        $janeId = $this->seedCardViaPdo('bob', 'jane-doe.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
VCARD);

        $joeId = $this->seedCardViaPdo('bob', 'joe-example.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
VCARD);

        $groupId = $this->seedCardViaPdo('bob', 'friends-group.vcf', <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD);

        return [$groupId, $janeId, $joeId];
    }

    private function findBobCard(string $cardId): ?Card
    {
        $cardUri = str_ends_with($cardId, '.vcf') ? $cardId : $cardId.'.vcf';
        $bookIds = Addressbook::query()
            ->where('principaluri', 'principals/bob')
            ->pluck('id');

        return Card::query()
            ->whereIn('addressbookid', $bookIds)
            ->where(function ($query) use ($cardId, $cardUri): void {
                $query->where('uri', $cardId)
                    ->orWhere('uri', $cardUri);
            })
            ->first();
    }
}
