<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class ContactsCardVcfTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_download_vcf_returns_vcard_body(): void
    {
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:test-1234\r\nFN:Jane Doe\r\nN:Doe;Jane;;;\r\nEMAIL:jane@example.com\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'jane-doe.vcf', $vcard);

        $response = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/contacts/cards/'.$cardId.'/vcf');

        $response->assertOk();
        $this->assertStringContainsString('text/vcard', $response->headers->get('Content-Type') ?? '');
        $this->assertStringContainsString('attachment', $response->headers->get('Content-Disposition') ?? '');
        $this->assertStringContainsString('.vcf', $response->headers->get('Content-Disposition') ?? '');

        $body = $response->getContent();
        $this->assertIsString($body);
        $this->assertStringContainsString('BEGIN:VCARD', $body);
        $this->assertStringContainsString('FN:Jane Doe', $body);
        $this->assertMatchesRegularExpression('/EMAIL(?:;[^:]*)?:jane@example\.com/i', $body);
        $this->assertStringContainsString('END:VCARD', $body);
    }

    public function test_download_vcf_emits_apple_labels_for_stale_prop_id_tel(): void
    {
        // Shape reported from macOS: PROP-ID + TYPE=cell, no X-ABLabel / itemN group.
        // Download must re-serialize so Contacts shows "Mobile" instead of "prop-id".
        $propId = '338c4e93-87cd-4025-879e-8348955d1897';
        $vcard = <<<VCARD
BEGIN:VCARD
VERSION:4.0
UID:urn:uuid:fc94bdf5-ee77-48ba-ad6e-67a47a18649e
KIND:individual
FN:Wouter Vroege
N:Vroege;Wouter;;;;;
TEL;PROP-ID={$propId};TYPE=cell:0642345325
END:VCARD

VCARD;
        $cardId = $this->seedCardViaPdo('bob', 'wouter-vroege.vcf', $vcard);

        $body = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/contacts/cards/'.$cardId.'/vcf')
            ->assertOk()
            ->getContent();

        $this->assertIsString($body);
        $unfolded = str_replace(["\r\n ", "\n "], '', $body);

        $this->assertMatchesRegularExpression('/item\d+\.TEL;PROP-ID='.$propId.';TYPE=cell:/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.X-ABLABEL:Mobile/i', $unfolded);
        $this->assertStringContainsString('PROP-ID='.$propId, $unfolded);
    }

    public function test_download_vcf_preserves_apple_properties(): void
    {
        $vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:urn:uuid:apple-1234\r\nFN:Apple User\r\nX-ADDRESSBOOKSERVER-KIND:group\r\nX-ADDRESSBOOKSERVER-MEMBER:urn:uuid:member-1\r\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/fakebase64==\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'apple-user.vcf', $vcard);

        $body = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/contacts/cards/'.$cardId.'/vcf')
            ->assertOk()
            ->getContent();

        $this->assertIsString($body);
        $unfolded = str_replace(["\r\n ", "\n "], '', $body);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-KIND:group', $unfolded);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:member-1', $unfolded);
        $this->assertMatchesRegularExpression('/PHOTO;[^:]*ENCODING=b;[^:]*TYPE=JPEG:/i', $unfolded);
    }

    public function test_download_vcf_returns_404_for_missing_card(): void
    {
        $this->withBearer($this->userBearerToken())
            ->get('/api/v1/contacts/cards/does-not-exist/vcf')
            ->assertNotFound();
    }

    public function test_download_vcf_returns_404_for_other_users_card(): void
    {
        $vcard = $this->sampleVcard('Carol Contact');
        $cardId = $this->seedCardViaPdo('carol', 'carol.vcf', $vcard);

        $this->withBearer($this->userBearerToken())
            ->get('/api/v1/contacts/cards/'.$cardId.'/vcf')
            ->assertNotFound();
    }

    public function test_download_vcf_requires_authentication(): void
    {
        $cardId = $this->seedCardViaPdo('bob', 'unauth.vcf', $this->sampleVcard('Unauth User'));

        $this->getJson('/api/v1/contacts/cards/'.$cardId.'/vcf')
            ->assertUnauthorized();
    }
}
