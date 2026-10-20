<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Services\Mcp\McpScopes;
use Illuminate\Testing\TestResponse;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpConsentRoundTripTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SettingsTestFixtures;

    private ?TestResponse $consentPage = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSettingsFixtures();
        $this->enableMcp();
    }

    protected function tearDown(): void
    {
        $this->tearDownSettingsFixtures();
        parent::tearDown();
    }

    public function test_double_submit_replays_the_first_redirect(): void
    {
        $form = $this->openConsentPage();

        $first = $this->post('/oauth/authorize', $form)->assertRedirect();
        $location = (string) $first->headers->get('Location');
        $this->assertStringStartsWith('https://claude.ai/callback?code=', $location);

        $this->post('/oauth/authorize', $form)->assertRedirect($location);
    }

    public function test_double_deny_replays_the_first_redirect(): void
    {
        $form = $this->openConsentPage();

        $first = $this->delete('/oauth/authorize', $form)->assertRedirect();
        $location = (string) $first->headers->get('Location');
        $this->assertStringContainsString('error=access_denied', $location);

        $this->delete('/oauth/authorize', $form)->assertRedirect($location);
    }

    public function test_unknown_auth_token_is_still_forbidden(): void
    {
        $form = $this->openConsentPage();
        $this->post('/oauth/authorize', $form)->assertRedirect();

        $this->post('/oauth/authorize', ['auth_token' => 'forged'] + $form)->assertForbidden();
    }

    public function test_consent_page_form_action_allows_only_the_client_redirect_origin(): void
    {
        $this->openConsentPage();
        $csp = (string) $this->consentPage?->headers->get('Content-Security-Policy');

        // CSP checks the redirect after Allow against form-action; 'self' alone blocks it.
        $this->assertStringContainsString("; form-action 'self' https://claude.ai; ", $csp);
    }

    public function test_other_pages_keep_form_action_self(): void
    {
        $csp = (string) $this->get('/login')->headers->get('Content-Security-Policy');

        $this->assertStringContainsString("; form-action 'self'; ", $csp);
    }

    public function test_consent_page_script_carries_the_csp_nonce(): void
    {
        $this->openConsentPage();
        $response = $this->consentPage;
        $csp = (string) $response->headers->get('Content-Security-Policy');
        preg_match('/<script nonce="([^"]+)"/', (string) $response->getContent(), $nonce);

        $this->assertNotEmpty($nonce[1] ?? '');
        $this->assertStringContainsString("'nonce-".$nonce[1]."'", $csp);
    }

    /**
     * @return array<string, mixed>
     */
    private function openConsentPage(): array
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $verifier = str_repeat('round-trip-verifier-', 3);
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        $this->actingAs($user, 'web');
        $page = $this->get('/oauth/authorize?'.http_build_query([
            'response_type' => 'code',
            'client_id' => (string) $client->getKey(),
            'redirect_uri' => 'https://claude.ai/callback',
            'scope' => McpScopes::DRIVE_READ.' '.McpScopes::MAIL_READ,
            'state' => 'xyz',
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ]));
        $page->assertOk();
        $this->consentPage = $page;
        $html = (string) $page->getContent();
        preg_match('/name="auth_token" value="([^"]*)"/', $html, $token);
        preg_match('/name="intent" value="([^"]*)"/', $html, $intent);
        $this->assertNotEmpty($token[1] ?? '');

        return [
            'auth_token' => html_entity_decode($token[1]),
            'intent' => html_entity_decode($intent[1]),
            'client_id' => (string) $client->getKey(),
            'scope' => [McpScopes::DRIVE_READ],
        ];
    }
}
