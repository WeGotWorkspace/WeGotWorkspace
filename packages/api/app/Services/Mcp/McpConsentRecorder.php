<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpConsent;
use Illuminate\Support\Carbon;

/**
 * Remembers where and when a user approved an assistant: the consent browser's
 * user agent and the time. One row per user and client; a new approval
 * replaces it. No IP address is stored.
 */
final class McpConsentRecorder
{
    public const USER_AGENT_MAX = 512;

    public function record(string $username, string $clientId, ?string $userAgent): void
    {
        if ($username === '' || $clientId === '') {
            return;
        }
        McpConsent::query()->updateOrCreate(
            ['username' => $username, 'client_id' => $clientId],
            ['user_agent' => $this->trimUserAgent($userAgent), 'approved_at' => now()],
        );
    }

    /**
     * @return array<string, array{userAgent: string|null, approvedAt: string}>
     */
    public function forUser(string $username): array
    {
        $byClient = [];
        foreach (McpConsent::query()->where('username', $username)->get() as $row) {
            $byClient[$row->client_id] = [
                'userAgent' => $row->user_agent,
                'approvedAt' => Carbon::parse((string) $row->approved_at)->toIso8601String(),
            ];
        }

        return $byClient;
    }

    public function forget(string $username, string $clientId): void
    {
        McpConsent::query()->where('username', $username)->where('client_id', $clientId)->delete();
    }

    public function forgetUser(string $username): void
    {
        McpConsent::query()->where('username', $username)->delete();
    }

    private function trimUserAgent(?string $userAgent): ?string
    {
        $userAgent = trim((string) $userAgent);

        return $userAgent === '' ? null : mb_substr($userAgent, 0, self::USER_AGENT_MAX);
    }
}
