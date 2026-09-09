<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpOAuthLoginRedirect;
use App\Services\Mcp\McpScopes;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpOAuthSessionTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SettingsTestFixtures;

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

    public function test_guest_session_redirects_to_pwa_login_not_blade(): void
    {
        $response = $this->get('/oauth/session');

        $response->assertRedirect();
        $location = (string) $response->headers->get('Location');
        $this->assertStringContainsString('/login?', $location);
        $this->assertStringNotContainsString('Sign in to connect an assistant', (string) $response->getContent());

        $query = [];
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame(McpOAuthLoginRedirect::AUTHORIZE_PATH, $query['return'] ?? null);
        $this->assertNotSame('', $query['intent'] ?? '');
    }

    public function test_guest_session_preserves_authorize_query_in_return(): void
    {
        $intended = url('/oauth/authorize?client_id=abc&state=s1');
        $response = $this->withSession(['url.intended' => $intended])->get('/oauth/session');

        $response->assertRedirect();
        $location = (string) $response->headers->get('Location');
        $query = [];
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame('/oauth/authorize?client_id=abc&state=s1', $query['return'] ?? null);
    }

    public function test_web_session_skips_login_and_returns_to_authorize(): void
    {
        $user = $this->mcpUser('bob');
        $this->actingAs($user, 'web');
        session()->put('url.intended', url('/oauth/authorize?client_id=abc'));

        $this->get('/oauth/session')
            ->assertRedirect('/oauth/authorize?client_id=abc');
    }

    public function test_spa_jwt_does_not_skip_oauth_login(): void
    {
        $this->mcpUser('bob');
        $token = $this->issueBearerTokenFor('bob');

        $this->withBearer($token)
            ->get('/oauth/session')
            ->assertRedirect();
        $this->assertGuest('web');
        $location = (string) $this->withBearer($token)->get('/oauth/session')->headers->get('Location');
        $this->assertStringContainsString('/login?', $location);
    }

    public function test_invalid_credentials_do_not_create_a_web_session(): void
    {
        $this->mcpUser('bob');
        $intent = app(ConsentIntent::class)->issue('_login', 'session');

        $this->postJson('/oauth/session', [
            'username' => 'bob',
            'password' => 'wrong-password',
            'intent' => $intent,
        ])->assertUnauthorized()
            ->assertJsonPath('error', 'Those credentials were not recognized.');

        $this->assertGuest('web');
    }

    public function test_guest_login_then_authorize_consent(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $authorize = $this->authorizeUrl((string) $client->getKey(), 'https://claude.ai/callback');

        $guest = $this->get($authorize);
        $guest->assertRedirect();
        $loginRoute = (string) $guest->headers->get('Location');
        $this->assertStringContainsString('/oauth/session', $loginRoute);

        $sessionPage = $this->get($loginRoute);
        $sessionPage->assertRedirect();
        $pwa = (string) $sessionPage->headers->get('Location');
        $this->assertStringContainsString('/login?', $pwa);
        $query = [];
        parse_str((string) parse_url($pwa, PHP_URL_QUERY), $query);
        $this->assertNotFalse(str_starts_with((string) ($query['return'] ?? ''), '/oauth/authorize'));
        $this->assertNotSame('', $query['intent'] ?? '');

        $this->post('/oauth/session', [
            'username' => 'bob',
            'password' => 'secret',
            'intent' => $query['intent'],
        ])->assertRedirect($query['return']);
        $this->assertAuthenticatedAs($user, 'web');

        $this->get($query['return'])
            ->assertOk()
            ->assertSee('Connect assistant', false)
            ->assertSee('Data is sent to the assistant vendor’s model.', false)
            ->assertDontSee('Sign in to connect an assistant', false);
    }

    public function test_session_stored_intent_allows_json_login_without_body_token(): void
    {
        $user = $this->mcpUser('bob');
        $this->get('/oauth/session')->assertRedirect();

        $this->postJson('/oauth/session', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('redirect', McpOAuthLoginRedirect::AUTHORIZE_PATH);
        $this->assertAuthenticatedAs($user, 'web');
    }

    private function authorizeUrl(string $clientId, string $redirectUri): string
    {
        $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        return '/oauth/authorize?'.http_build_query([
            'client_id' => $clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => McpScopes::DRIVE_READ,
            'state' => 'state-1',
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ]);
    }
}
