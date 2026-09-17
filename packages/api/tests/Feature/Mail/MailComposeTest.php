<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Mail\MailOperationService;
use App\Services\Mail\MailResponseException;
use App\Support\WgwSettings;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailComposeTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownMailFixtures();
        parent::tearDown();
    }

    public function test_send_without_credentials_returns_mailbox_not_configured(): void
    {
        try {
            app(MailOperationService::class)->send('bob', [
                'to' => 'recipient@example.test',
                'subject' => 'Hello',
                'body' => 'Body',
            ]);
            $this->fail('Expected MAIL_SETTINGS_MISSING');
        } catch (MailResponseException $e) {
            $this->assertSame(400, $e->status);
            $this->assertSame('MAIL_SETTINGS_MISSING', $e->payload['error'] ?? null);
        }
    }

    public function test_send_without_to_returns_to_required(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        try {
            app(MailOperationService::class)->send('bob', [
                'subject' => 'Hello',
                'body' => 'Body',
            ]);
            $this->fail('Expected to_required');
        } catch (MailResponseException $e) {
            $this->assertSame(400, $e->status);
            $this->assertSame('to_required', $e->payload['error'] ?? null);
        }
    }

    public function test_send_uses_this_users_smtp_not_instance_host(): void
    {
        $this->setAppSettings([
            WgwSettings::MAIL_SMTP_HOST => 'smtp.instance.test',
            WgwSettings::MAIL_SMTP_PORT => 25,
        ]);
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret', [
            'smtpHost' => '127.0.0.1',
            'smtpPort' => 9,
            'smtpSecurity' => 'none',
        ]);

        try {
            app(MailOperationService::class)->send('bob', [
                'to' => 'recipient@example.test',
                'subject' => 'Hello',
                'body' => 'Body',
            ]);
            $this->fail('Expected SMTP failure against the user mailbox host');
        } catch (MailResponseException $e) {
            $this->assertContains($e->payload['error'] ?? null, ['smtp_connect', 'send_failed']);
            $this->assertSame('127.0.0.1', $e->payload['smtp']['host'] ?? null);
            $this->assertSame(9, $e->payload['smtp']['port'] ?? null);
            $this->assertStringNotContainsString('smtp.instance.test', (string) ($e->payload['message'] ?? ''));
        }
    }

    public function test_removed_compose_rest_paths_return_not_found(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/messages', [
            'to' => 'recipient@example.test',
            'subject' => 'Hello',
            'body' => 'Body',
        ])->assertNotFound();

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/drafts', [
            'subject' => 'Draft',
            'body' => 'Work in progress',
        ])->assertNotFound();
    }

    public function test_email_submission_without_identity_id_is_rejected_on_the_envelope(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::MAIL, JmapCapabilities::SUBMISSION],
            'methodCalls' => [
                ['EmailSubmission/set', ['accountId' => 'bob', 'create' => ['s0' => ['emailId' => 'x']]], 'c1'],
            ],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.notCreated.s0.properties.0', 'identityId');
    }
}
