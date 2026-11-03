<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\JwtTokenService;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Seeds the fixture principals and groups, and sends requests as an Actor.
 *
 * Tokens for member and admin are minted at seed time, before any
 * former-group removal, so `former-group` cases reuse a token issued while
 * the actor was still a member. Headers are passed per request and never
 * stored as client defaults, so one case cannot leak its token into the next.
 *
 * @mixin WgwDatabaseTestCase
 */
trait OwnershipWorld
{
    /** @var array<string, string> actor value => bearer token */
    private array $ownershipTokens = [];

    private ?string $ownershipGuestToken = null;

    protected function seedOwnershipWorld(): void
    {
        $this->configureWgwJwtKeys();

        foreach ([OwnershipPrincipals::MEMBER, OwnershipPrincipals::ADMIN, OwnershipPrincipals::CAROL, OwnershipPrincipals::DAVE] as $username) {
            $this->seedOwnershipUser($username);
        }

        $admins = $this->seedWgwGroup(OwnershipPrincipals::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($admins, $this->ownershipPrincipal(OwnershipPrincipals::ADMIN));

        foreach (OwnershipPrincipals::memberships() as $slug => $members) {
            $group = $this->seedWgwGroup(OwnershipPrincipals::groupUri($slug), ucfirst($slug));
            foreach ($members as $username) {
                $this->addPrincipalToGroup($group, $this->ownershipPrincipal($username));
            }
        }

        $this->ownershipTokens = [];
        $this->ownershipGuestToken = null;
        foreach (Actor::signedIn() as $actor) {
            $this->ownershipTokens[$actor->value] = $this->mintUserToken(
                $this->usernameFor($actor),
                $actor === Actor::Admin ? 'admin' : 'user',
            );
        }
    }

    protected function usernameFor(Actor $actor): string
    {
        return match ($actor) {
            Actor::Member => OwnershipPrincipals::MEMBER,
            Actor::Admin => OwnershipPrincipals::ADMIN,
            Actor::Anonymous, Actor::Guest => throw new LogicException($actor->value.' has no username in the fixture world.'),
        };
    }

    /**
     * JMAP accounts are per user: the accountId is the username.
     */
    protected function accountIdFor(Actor $actor): string
    {
        return $this->usernameFor($actor);
    }

    protected function tokenFor(Actor $actor): ?string
    {
        return match ($actor) {
            Actor::Anonymous => null,
            Actor::Guest => $this->ownershipGuestToken ??= $this->mintGuestToken(),
            Actor::Member, Actor::Admin => $this->ownershipTokens[$actor->value]
                ?? throw new LogicException('Call seedOwnershipWorld() before sending requests.'),
        };
    }

    /**
     * Public-scope cases set the guest token from a real share-session exchange.
     */
    protected function useGuestToken(string $token): void
    {
        $this->ownershipGuestToken = $token;
    }

    /**
     * A guest-role JWT that is not bound to any share link. Use it for role
     * cases only; public scopes must use useGuestToken() with a real session.
     */
    protected function mintGuestToken(string $subject = 'share:ownership-matrix'): string
    {
        return app(JwtTokenService::class)->issue([
            'sub' => $subject,
            'role' => 'guest',
            'exp' => time() + 3600,
        ]);
    }

    /**
     * Removes the actor from `alumni`. Its token, minted before, stays valid.
     */
    protected function leaveFormerGroup(Actor $actor): void
    {
        $this->removeFromGroup($actor, OwnershipPrincipals::ALUMNI);
    }

    /**
     * Removes the actor from `crew`, the group a `user-to-actor-group` grant
     * reaches it through. Its token, minted before, stays valid.
     */
    protected function leaveCrew(Actor $actor): void
    {
        $this->removeFromGroup($actor, OwnershipPrincipals::CREW);
    }

    private function removeFromGroup(Actor $actor, string $slug): void
    {
        $group = $this->ownershipPrincipalByUri(OwnershipPrincipals::groupUri($slug));
        $member = $this->ownershipPrincipal($this->usernameFor($actor));

        GroupMember::query()
            ->where('principal_id', $group->id)
            ->where('member_id', $member->id)
            ->delete();
    }

    /**
     * @return array<string, string>
     */
    protected function headersFor(Actor $actor): array
    {
        return $this->bearerHeaders($this->tokenFor($actor));
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     */
    protected function requestAs(Actor $actor, string $method, string $uri, array $data = [], array $headers = []): TestResponse
    {
        return $this->json($method, '/api/v1'.$uri, $data, array_merge($this->headersFor($actor), $headers));
    }

    /**
     * Sends a request as any fixture principal, for seeding targets as their
     * owner (carol, dave) or for reading the owner's view in a snapshot.
     *
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     */
    protected function requestAsUsername(string $username, string $method, string $uri, array $data = [], array $headers = []): TestResponse
    {
        $token = match ($username) {
            OwnershipPrincipals::MEMBER => $this->tokenFor(Actor::Member),
            OwnershipPrincipals::ADMIN => $this->tokenFor(Actor::Admin),
            default => $this->ownershipTokens['user:'.$username] ??= $this->mintUserToken($username, 'user'),
        };

        return $this->json($method, '/api/v1'.$uri, $data, array_merge($this->bearerHeaders($token), $headers));
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>  $using
     */
    protected function jmapAs(Actor $actor, array $methodCalls, array $using): TestResponse
    {
        return $this->requestAs($actor, 'POST', '/jmap', [
            'using' => $using,
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * Like seedWgwUser(), without its two bcrypt hashes per user (~0.35 s).
     * Matrix tokens are minted directly, so the password is never checked;
     * the digest is still a valid hash of "secret".
     */
    private function seedOwnershipUser(string $username): void
    {
        static $digest = null;
        $digest ??= password_hash('secret', PASSWORD_BCRYPT, ['cost' => 4]);

        User::query()->create([
            'username' => $username,
            'digest' => $digest,
            'digesta1' => '',
        ]);
        Principal::factory()->forUsername($username, ucfirst($username))->create();
    }

    private function mintUserToken(string $username, string $role): string
    {
        $uid = User::query()->where('username', $username)->value('id');

        return app(JwtTokenService::class)->issue([
            'sub' => $username,
            'role' => $role,
            'exp' => time() + 3600,
            'uid' => (int) $uid,
        ]);
    }

    private function ownershipPrincipal(string $username): Principal
    {
        return Principal::forUsername($username)
            ?? throw new LogicException('Fixture principal missing: '.$username);
    }

    private function ownershipPrincipalByUri(string $uri): Principal
    {
        return Principal::query()->where('uri', $uri)->first()
            ?? throw new LogicException('Fixture principal missing: '.$uri);
    }
}
