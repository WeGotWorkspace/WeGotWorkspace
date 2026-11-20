<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Exceptions\ApiHttpException;
use App\Models\AuthChallenge;
use Illuminate\Support\Carbon;

/**
 * Single-use challenges between a correct password and a code. The id is 32
 * random bytes as hex; only its sha256 is stored. A challenge lives ten minutes
 * and stops after five failed codes.
 */
final class AuthChallengeService
{
    public const int TTL_SECONDS = 600;

    public const int MAX_ATTEMPTS = 5;

    public function issue(string $username, string $kind, string $client, ?string $pendingSecret = null): string
    {
        $id = bin2hex(random_bytes(32));
        $now = Carbon::now();
        AuthChallenge::query()->create([
            'id_hash' => hash('sha256', $id),
            'username' => strtolower(trim($username)),
            'kind' => $kind,
            'client' => $client,
            'pending_secret' => $pendingSecret,
            'attempts' => 0,
            'expires_at' => $now->copy()->addSeconds(self::TTL_SECONDS),
            'created_at' => $now,
        ]);

        return $id;
    }

    /**
     * The open challenge with this id, for this client. Unknown, malformed,
     * expired, used, and other-client challenges are all `null`, so a caller
     * cannot tell them apart.
     */
    public function findOpen(string $id, string $client): ?AuthChallenge
    {
        $id = strtolower(trim($id));
        if (preg_match('/^[a-f0-9]{64}$/', $id) !== 1) {
            return null;
        }

        $row = AuthChallenge::query()->where('id_hash', hash('sha256', $id))->first();
        if ($row === null
            || $row->consumed_at !== null
            || $row->expires_at->lessThanOrEqualTo(Carbon::now())
            || $row->client !== $client
            || $row->attempts >= self::MAX_ATTEMPTS) {
            return null;
        }

        return $row;
    }

    /**
     * Marks the challenge used. A second caller racing on the same id gets 404.
     */
    public function consume(AuthChallenge $challenge): void
    {
        $claimed = AuthChallenge::query()
            ->whereKey($challenge->id)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => Carbon::now()]);
        if ($claimed !== 1) {
            throw self::notFound();
        }
    }

    /**
     * Counts this try before the code is read, with an atomic conditional
     * update, so parallel requests cannot get more than MAX_ATTEMPTS tries on
     * one challenge. False when the tries are used up.
     */
    public function reserveAttempt(AuthChallenge $challenge): bool
    {
        return AuthChallenge::query()
            ->whereKey($challenge->id)
            ->whereNull('consumed_at')
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->increment('attempts') === 1;
    }

    public function forgetUser(string $username): void
    {
        AuthChallenge::query()->where('username', strtolower(trim($username)))->delete();
    }

    public static function notFound(): ApiHttpException
    {
        return new ApiHttpException(404, 'This sign-in step has expired. Sign in again.', 'not_found');
    }
}
