<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The TURN shared secret is write-only: an administrator can set, replace or
 * clear it, but no API response may ever hand it back. These tests guard that
 * claim from both ends.
 */
final class AdminTurnSecretTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    private const SECRET = 'correct-horse-battery-staple';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_the_secret_never_appears_in_admin_state(): void
    {
        $token = $this->adminBearerToken();
        $this->saveSecret($token, self::SECRET);

        $response = $this->withBearer($token)->getJson('/api/v1/admin/state')->assertOk();

        $this->assertStringNotContainsString(self::SECRET, $response->getContent() ?: '');
        $this->assertSame(
            ['stunUrls', 'turnUrls', 'turnSecretSet', 'turnStaticCredentialsPresent'],
            array_keys((array) $response->json('rtc')),
        );
        $response->assertJsonPath('rtc.turnSecretSet', true)
            ->assertJsonMissingPath('rtc.turnSecret')
            ->assertJsonMissingPath('rtc.rtc_turn_secret');
    }

    public function test_the_secret_is_stored_even_though_it_is_not_readable_over_http(): void
    {
        $this->saveSecret($this->adminBearerToken(), self::SECRET);

        $this->assertSame(self::SECRET, AppSetting::getValue(SettingKeys::RTC_TURN_SECRET));
    }

    public function test_an_empty_value_leaves_the_stored_secret_alone(): void
    {
        $token = $this->adminBearerToken();
        $this->saveSecret($token, self::SECRET);

        // The admin form cannot show the secret, so it submits an empty field
        // whenever the administrator did not retype it.
        $this->saveSecret($token, '');

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnSecretSet', true);
        $this->assertSame(self::SECRET, AppSetting::getValue(SettingKeys::RTC_TURN_SECRET));
    }

    public function test_an_explicit_clear_removes_the_secret(): void
    {
        $token = $this->adminBearerToken();
        $this->saveSecret($token, self::SECRET);

        $this->withBearer($token)->putJson('/api/v1/admin/settings', [
            'values' => [],
            'clearTurnSecret' => true,
        ])->assertOk();

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnSecretSet', false);
        $this->assertSame('', AppSetting::getValue(SettingKeys::RTC_TURN_SECRET));
    }

    public function test_leftover_static_credentials_are_flagged_until_a_secret_replaces_them(): void
    {
        $this->setAppSettings([
            'rtc_turn_username' => 'legacy-user',
            'rtc_turn_credential' => 'legacy-password',
        ]);
        $token = $this->adminBearerToken();

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnStaticCredentialsPresent', true);

        $this->saveSecret($token, self::SECRET);

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnStaticCredentialsPresent', false);
        $this->assertNull(AppSetting::getValue('rtc_turn_username'));
        $this->assertNull(AppSetting::getValue('rtc_turn_credential'));
    }

    private function saveSecret(string $token, string $secret): void
    {
        $this->withBearer($token)->putJson('/api/v1/admin/settings', [
            'values' => [
                SettingKeys::RTC_TURN_URL => 'turn:relay.example.test:3478',
                SettingKeys::RTC_TURN_SECRET => $secret,
            ],
        ])->assertOk();
    }
}
