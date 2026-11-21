<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use Illuminate\Support\Carbon;
use PragmaRX\Google2FA\Google2FA;
use Throwable;

/**
 * RFC 6238 codes: SHA-1, 6 digits, 30-second steps, one step either side.
 * The window is passed explicitly, and {@see matchingStep()} returns the step of
 * the code that matched, so the caller can store it and refuse a replay.
 */
final class TotpService
{
    public const int WINDOW = 1;

    public const int PERIOD = 30;

    public function generateSecret(): string
    {
        return (new Google2FA)->generateSecretKey(32);
    }

    public function provisioningUri(string $host, string $username, string $secret): string
    {
        $issuer = 'WeGotWorkspace'.($host !== '' ? ' ('.$host.')' : '');
        $query = http_build_query([
            'secret' => $secret,
            'issuer' => $issuer,
            'algorithm' => 'SHA1',
            'digits' => 6,
            'period' => self::PERIOD,
        ], '', '&', PHP_QUERY_RFC3986);

        return 'otpauth://totp/'.rawurlencode($issuer.':'.$username).'?'.$query;
    }

    /**
     * The step of a matching code newer than $lastUsedStep, or null. Spaces in
     * the code are ignored (`123 456`).
     */
    public function matchingStep(string $secret, string $code, ?int $lastUsedStep): ?int
    {
        $code = (string) preg_replace('/\s+/', '', $code);
        if (preg_match('/^\d{6}$/', $code) !== 1) {
            return null;
        }

        try {
            $step = (new Google2FA)->verifyKeyNewer($secret, $code, $lastUsedStep ?? -1, self::WINDOW, $this->currentStep());
        } catch (Throwable) {
            return null;
        }

        return is_int($step) ? $step : null;
    }

    public function currentStep(): int
    {
        return intdiv(Carbon::now()->getTimestamp(), self::PERIOD);
    }
}
