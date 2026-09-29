<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\UserMfa;
use Illuminate\Support\Carbon;
use PragmaRX\Google2FA\Google2FA;
use Throwable;

final class TotpService
{
    public const string REUSED_MESSAGE = 'Wait for the next code.';

    public function generateSecret(): string
    {
        return $this->engine()->generateSecretKey(32);
    }

    public function issuer(?string $baseUri, string $requestHost): string
    {
        $host = trim($requestHost);
        $configured = trim((string) $baseUri);
        if ($configured !== '') {
            $candidate = str_contains($configured, '://') ? $configured : 'https://'.$configured;
            $parsed = parse_url($candidate, PHP_URL_HOST);
            if (is_string($parsed) && $parsed !== '') {
                $host = $parsed;
            }
        }
        if ($host === '') {
            $host = 'localhost';
        }

        return 'WeGotWorkspace ('.$host.')';
    }

    public function provisioningUri(string $issuer, string $username, string $secret): string
    {
        $label = rawurlencode($issuer.':'.$username);
        $query = http_build_query([
            'secret' => $secret,
            'issuer' => $issuer,
            'algorithm' => 'SHA1',
            'digits' => 6,
            'period' => 30,
        ], '', '&', PHP_QUERY_RFC3986);

        return 'otpauth://totp/'.$label.'?'.$query;
    }

    /**
     * @return 'ok'|'invalid'|'reused'
     */
    public function consumeLive(string $username, string $code): string
    {
        $row = UserMfa::query()
            ->where('username', strtolower(trim($username)))
            ->whereNotNull('enabled_at')
            ->first();
        if (! $row instanceof UserMfa || ! is_string($row->totp_secret) || $row->totp_secret === '') {
            return 'invalid';
        }

        $step = $this->matchingStep($row->totp_secret, $code);
        if ($step === null) {
            return 'invalid';
        }
        if ($row->last_used_step !== null && $step <= (int) $row->last_used_step) {
            return 'reused';
        }

        $updated = UserMfa::query()
            ->where('id', $row->id)
            ->where(function ($query) use ($step): void {
                $query->whereNull('last_used_step')->orWhere('last_used_step', '<', $step);
            })
            ->update(['last_used_step' => $step]);

        return $updated === 1 ? 'ok' : 'reused';
    }

    public function matchingStep(string $secret, string $code): ?int
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (preg_match('/^\d{6}$/', $code) !== 1) {
            return null;
        }

        $engine = $this->engine();
        $current = $this->currentStep();
        try {
            for ($step = $current - 1; $step <= $current + 1; $step++) {
                if (hash_equals($engine->oathTotp($secret, $step), $code)) {
                    return $step;
                }
            }
        } catch (Throwable) {
            return null;
        }

        return null;
    }

    private function currentStep(): int
    {
        return (int) floor(Carbon::now()->getTimestamp() / 30);
    }

    private function engine(): Google2FA
    {
        $engine = new Google2FA;
        $engine->setWindow(1);

        return $engine;
    }
}
