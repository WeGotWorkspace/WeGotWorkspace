<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Contacts\ContactBlobService;
use Illuminate\Support\Str;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The photo-less first download (#2297): the client asks ContactCard/get for
 * every property except `media` (CONTACT_CARD_PROPERTIES_WITHOUT_MEDIA in
 * JmapContactsClient.ts), in pages of 200, and the photos later in a second
 * pass. The projection must not lose any other field, must skip the photo
 * blob work, and must keep a 200-card page short on shared hosting.
 */
final class ContactCardProjectedGetTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_the_photo_less_projection_keeps_every_other_property_of_a_rich_card(): void
    {
        $memberUid = 'urn:uuid:7f0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f20';
        $this->seedCardViaPdo('bob', 'member.vcf', $this->sampleVcard('Member Person', $memberUid));
        $richId = $this->seedCardViaPdo('bob', 'rich.vcf', $this->richVcard());
        $groupId = $this->seedCardViaPdo('bob', 'group.vcf', implode("\r\n", [
            'BEGIN:VCARD',
            'VERSION:4.0',
            'UID:urn:uuid:5e0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f99',
            'KIND:group',
            'FN:Team',
            'MEMBER:'.$memberUid,
            'END:VCARD',
            '',
        ]));
        $properties = $this->clientPropertiesWithoutMedia();
        $this->assertNotContains('media', $properties);

        foreach ([$richId, $groupId] as $cardId) {
            $full = $this->getCards([$cardId])[0];
            $projected = $this->getCards([$cardId], $properties)[0];

            $missing = array_diff(array_keys($full), $properties, ['id', 'media']);
            $this->assertSame(
                [],
                array_values($missing),
                'The server sends properties the photo-less first download does not ask for. '
                .'Add them to CONTACT_CARD_PROPERTIES_WITHOUT_MEDIA in JmapContactsClient.ts.',
            );
            $withoutMedia = $full;
            unset($withoutMedia['media']);
            ksort($withoutMedia);
            ksort($projected);
            $this->assertSame($withoutMedia, $projected);
        }

        $full = $this->getCards([$richId])[0];
        $this->assertArrayHasKey('media', $full);
        $photos = $this->getCards([$richId], ['media', 'state'])[0];
        $this->assertSame(['id', 'media', 'state'], $this->sortedKeys($photos));
        $this->assertSame($full['media'], $photos['media']);
        $this->assertSame($full['state'], $photos['state']);
    }

    public function test_the_lean_projection_carries_what_the_list_reads_and_nothing_of_the_detail(): void
    {
        $memberUid = 'urn:uuid:7f0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f21';
        $this->seedCardViaPdo('bob', 'member.vcf', $this->sampleVcard('Member Person', $memberUid));
        $richId = $this->seedCardViaPdo('bob', 'rich.vcf', $this->richVcard());
        $groupId = $this->seedCardViaPdo('bob', 'group.vcf', implode("\r\n", [
            'BEGIN:VCARD',
            'VERSION:4.0',
            'UID:urn:uuid:5e0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f98',
            'KIND:group',
            'FN:Team',
            'MEMBER:'.$memberUid,
            'END:VCARD',
            '',
        ]));
        $lean = $this->clientLeanProperties();
        $this->assertNotContains('media', $lean);
        $this->assertNotContains('phones', $lean);

        foreach ([$richId, $groupId] as $cardId) {
            $full = $this->getCards([$cardId])[0];
            $projected = $this->getCards([$cardId], $lean)[0];

            // Only the asked-for properties (and the id) come back, with the values of the whole card.
            $this->assertSame([], array_values(array_diff(array_keys($projected), $lean, ['id'])));
            foreach (array_intersect($lean, array_keys($full)) as $property) {
                $this->assertSame($full[$property], $projected[$property], $property);
            }
        }

        // What the list and the invitee search read: name, emails, and the group fields.
        $rich = $this->getCards([$richId], $lean)[0];
        $this->assertArrayHasKey('name', $rich);
        $this->assertArrayHasKey('emails', $rich);
        $this->assertArrayNotHasKey('phones', $rich);
        $group = $this->getCards([$groupId], $lean)[0];
        $this->assertSame('group', $group['kind']);
        $this->assertNotEmpty($group['members']);
    }

    public function test_the_limit_is_1000_ids_and_one_more_is_request_too_large(): void
    {
        $this->seedCardViaPdo('bob', 'one.vcf', $this->sampleVcard('One', 'urn:uuid:1a0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f01'));
        $ids = array_map(static fn (int $i): string => "missing-{$i}", range(1, 1000));
        $ok = $this->jmapContacts([['ContactCard/get', ['accountId' => 'bob', 'ids' => $ids, 'properties' => $this->clientLeanProperties()], 'g']])
            ->assertOk();
        $this->assertSame('ContactCard/get', $ok->json('methodResponses.0.0'));
        $this->assertCount(1000, $ok->json('methodResponses.0.1.notFound'));

        $ids[] = 'missing-1001';
        $this->jmapContacts([['ContactCard/get', ['accountId' => 'bob', 'ids' => $ids], 'g']])
            ->assertOk()
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');
    }

    public function test_a_projection_without_media_does_no_photo_blob_work(): void
    {
        // Photo bytes no other test stores: the blob store outlives a test.
        $photoBytes = 'photo-'.bin2hex(random_bytes(8));
        $cardId = $this->seedCardViaPdo('bob', 'rich.vcf', $this->richVcard('Rich Person', $photoBytes));
        $blobs = app(ContactBlobService::class);
        $blobId = $blobs->blobIdFromContent($photoBytes, 'image/png');

        $this->getCards([$cardId], $this->clientPropertiesWithoutMedia());
        $this->assertNull($blobs->retrieve('bob', $blobId));

        $full = $this->getCards([$cardId])[0];
        $this->assertNotNull($blobs->retrieve('bob', $blobId));
        $this->assertContains($blobId, array_column($full['media'], 'blobId'));
    }

    public function test_a_200_card_photo_less_page_stays_under_two_seconds(): void
    {
        $ids = [];
        for ($index = 0; $index < 200; $index++) {
            $ids[] = $this->seedCardViaPdo('bob', "card-{$index}.vcf", $this->richVcard("Person {$index}"));
        }
        $properties = $this->clientPropertiesWithoutMedia();
        // Warm up the framework and the converter, as a running server is.
        $this->getCards([$ids[0]], $properties);

        $started = hrtime(true);
        $list = $this->getCards($ids, $properties);
        $seconds = (hrtime(true) - $started) / 1e9;

        $this->assertCount(200, $list);
        $this->assertLessThan(2.0, $seconds, sprintf('200 photo-less cards took %.2f s', $seconds));
    }

    /**
     * @param  list<string>  $ids
     * @param  list<string>|null  $properties
     * @return list<array<mixed>>
     */
    private function getCards(array $ids, ?array $properties = null): array
    {
        $args = ['accountId' => 'bob', 'ids' => $ids];
        if ($properties !== null) {
            $args['properties'] = $properties;
        }
        $list = $this->jmapContacts([['ContactCard/get', $args, 'g']])
            ->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'ContactCard/get')
            ->json('methodResponses.0.1.list');
        $this->assertIsArray($list);
        $this->assertCount(count($ids), $list);
        $cards = [];
        foreach ($list as $card) {
            $this->assertIsArray($card);
            $cards[] = $card;
        }

        return $cards;
    }

    /**
     * The list the client sends, read from its source so the two cannot drift.
     *
     * @return list<string>
     */
    private function clientPropertiesWithoutMedia(): array
    {
        $file = dirname(__DIR__, 5).'/packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts';
        $this->assertFileExists($file);
        $source = (string) file_get_contents($file);
        if (preg_match('/CONTACT_CARD_PROPERTIES_WITHOUT_MEDIA = \[(.*?)\];/s', $source, $list) !== 1) {
            $this->fail('CONTACT_CARD_PROPERTIES_WITHOUT_MEDIA not found in '.$file);
        }
        preg_match_all('/"([^"]+)"/', $list[1], $names);
        $this->assertNotEmpty($names[1]);

        return $names[1];
    }

    /**
     * @return list<string>
     */
    private function clientLeanProperties(): array
    {
        $file = dirname(__DIR__, 5).'/packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts';
        $source = (string) file_get_contents($file);
        if (preg_match('/CONTACT_CARD_PROPERTIES_LEAN = \[(.*?)\];/s', $source, $list) !== 1) {
            $this->fail('CONTACT_CARD_PROPERTIES_LEAN not found in '.$file);
        }
        preg_match_all('/"([^"]+)"/', $list[1], $names);
        $this->assertNotEmpty($names[1]);

        return $names[1];
    }

    /**
     * @param  array<mixed>  $card
     * @return list<int|string>
     */
    private function sortedKeys(array $card): array
    {
        $keys = array_keys($card);
        sort($keys);

        return $keys;
    }

    /** A card with a value for every vCard property the converter maps, and an inline photo. */
    private function richVcard(string $fullName = 'Rich Person', string $photoBytes = 'not-really-a-png-but-bytes'): string
    {
        $photo = base64_encode($photoBytes);

        return implode("\r\n", [
            'BEGIN:VCARD',
            'VERSION:4.0',
            'UID:urn:uuid:'.Str::uuid()->toString(),
            'PRODID:-//Example//Test//EN',
            'KIND:individual',
            'FN:'.$fullName,
            'N:Person;Rich;Middle;Dr.;Jr.',
            'NICKNAME:Richie',
            'GENDER:M',
            'BDAY:19800102',
            'ANNIVERSARY:20100605',
            'ORG:Example Inc.;Research',
            'TITLE:Researcher',
            'ROLE:Lead',
            'EMAIL;TYPE=work:rich@example.com',
            'TEL;VALUE=uri;TYPE=cell:tel:+31-6-1234-5678',
            'ADR;TYPE=home:;;Street 1;City;Region;1234 AB;Netherlands',
            'URL:https://example.com/rich',
            'IMPP:xmpp:rich@example.com',
            'LANG:nl',
            'CALURI:https://example.com/rich/calendar',
            'CALADRURI:mailto:rich@example.com',
            'FBURL:https://example.com/rich/freebusy',
            'KEY:https://example.com/rich/key.asc',
            'SOURCE:https://example.com/rich.vcf',
            'NOTE:A note.',
            'CATEGORIES:friends,work',
            'EXPERTISE:chemistry',
            'HOBBY:reading',
            'INTEREST:music',
            'RELATED;TYPE=friend:urn:uuid:7f0c2a51-3c55-4d7a-9a4a-1b1c1d1e1f20',
            'X-CUSTOM-THING:kept as a vCard property',
            'PHOTO:data:image/png;base64,'.$photo,
            'REV:20200101T000000Z',
            'END:VCARD',
            '',
        ]);
    }
}
