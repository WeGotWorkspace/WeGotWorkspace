<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use Illuminate\Testing\TestResponse;

/**
 * Shared identity fixtures for Meet API feature tests.
 */
trait MeetTestFixtures
{
    use WgwRoleFixtures;

    protected const MEET_ROOM_ID = 'daily-room';

    protected function setUpMeetFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedMeetRoleMatrix();
    }

    protected function seedMeetRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function meetRoomPath(string $suffix = ''): string
    {
        return '/api/v1/rooms/'.self::MEET_ROOM_ID.$suffix;
    }

    protected function meetStatusPath(?string $roomId = null): string
    {
        return '/api/v1/meetings/rooms/'.($roomId ?? self::MEET_ROOM_ID);
    }

    /**
     * @param  array{expiresAt?: string|null}  $extra
     */
    protected function reserveMeetRoom(
        string $roomId = self::MEET_ROOM_ID,
        string $ownerPrincipal = 'u:bob',
        ?string $token = null,
        array $extra = [],
    ): TestResponse {
        $body = ['room' => $roomId, 'ownerPrincipal' => $ownerPrincipal, ...$extra];

        return $this->withBearer($token ?? $this->userBearerToken())
            ->postJson('/api/v1/meetings/rooms', $body);
    }

    protected function withoutBearer(): static
    {
        return $this->withoutHeader('Authorization');
    }

    /**
     * @return array{sessionKey: string, peerId: string}
     */
    protected function guestJoin(string $peerId, string $name = 'Guest', ?string $sessionKey = null): array
    {
        $body = ['peerId' => $peerId, 'name' => $name];
        if ($sessionKey !== null) {
            $body['sessionKey'] = $sessionKey;
        }

        $response = $this->postJson($this->meetRoomPath('/participants'), $body);
        $response->assertOk();

        return [
            'sessionKey' => (string) $response->json('sessionKey'),
            'peerId' => $peerId,
        ];
    }
}
