<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminAccessControlTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

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

    public function test_guest_cannot_access_admin_endpoints(): void
    {
        $this->getJson('/api/v1/admin/state')->assertUnauthorized();
        $this->postJson('/api/v1/admin/users', [])->assertUnauthorized();
        $this->putJson('/api/v1/admin/settings', ['values' => []])->assertUnauthorized();
        $this->postJson('/api/v1/admin/mail-delivery/test')->assertUnauthorized();
        $this->getJson('/api/v1/admin/updates/state')->assertUnauthorized();
        $this->postJson('/api/v1/admin/search/jobs')->assertUnauthorized();
    }

    public function test_regular_users_cannot_access_admin_endpoints(): void
    {
        foreach ([$this->userBearerToken(), $this->carolBearerToken()] as $token) {
            $this->withBearer($token)->getJson('/api/v1/admin/state')->assertForbidden();
            $this->withBearer($token)->postJson('/api/v1/admin/users', [
                'username' => 'intruder',
                'password' => 'intruder-secret',
            ])->assertForbidden();
            $this->withBearer($token)->putJson('/api/v1/admin/settings', [
                'values' => ['timezone' => 'UTC'],
            ])->assertForbidden();
            $this->withBearer($token)->postJson('/api/v1/admin/mail-delivery/test')->assertForbidden();
            $this->withBearer($token)->getJson('/api/v1/admin/updates/state')->assertForbidden();
            $this->withBearer($token)->postJson('/api/v1/admin/search/jobs')->assertForbidden();
            $this->withBearer($token)->postJson('/api/v1/admin/update-jobs', ['type' => 'check'])->assertForbidden();
            $this->withBearer($token)->deleteJson('/api/v1/admin/backups/example.zip')->assertForbidden();
        }
    }

    public function test_admin_can_read_admin_state(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('currentUser', 'alice')
            ->assertJsonStructure([
                'users',
                'groups',
                'mail',
                'mailDelivery' => ['config', 'capability', 'lastTestSend'],
                'rtc',
                'apps',
                'webdav',
                'updates' => ['installedVersion', 'schemaVersion', 'backups'],
                'logoutUrl',
            ]);
    }

    public function test_non_admin_cannot_read_own_data_via_admin_state(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/admin/state')
            ->assertForbidden();
    }
}
