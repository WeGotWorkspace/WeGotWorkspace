<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;

final class RtcSettingsService
{
    /**
     * Static TURN credentials from installs before the relay request existed.
     * They are no longer honored: without a secret the relay stays off, and
     * admin warns about the leftovers instead of silently relaying.
     */
    private const LEGACY_TURN_USERNAME_KEY = 'rtc_turn_username';

    private const LEGACY_TURN_CREDENTIAL_KEY = 'rtc_turn_credential';

    public const DEFAULT_MEET_MAX_PEERS = 4;

    public const MIN_MEET_MAX_PEERS = 2;

    public const MAX_MEET_MAX_PEERS = 15;

    /**
     * Everything a client may know about the relay. Credentials are minted per
     * request by {@see RtcTurnCredentialService} and never appear here.
     *
     * @return array{stunUrls: string, turnAvailable: bool}
     */
    public function publicSettings(): array
    {
        return [
            'stunUrls' => $this->normalizeRtcUrls(AppSetting::getValue(SettingKeys::RTC_STUN_URL, ''), 'stun'),
            'turnAvailable' => $this->turnAvailable(),
        ];
    }

    /**
     * @return list<string>
     */
    public function turnUrls(): array
    {
        $normalized = $this->normalizeRtcUrls(AppSetting::getValue(SettingKeys::RTC_TURN_URL, ''), 'turn');
        if ($normalized === '') {
            return [];
        }

        return array_map('trim', explode(',', $normalized));
    }

    /**
     * Peers allowed in one meeting room. Clamped: below the floor a call is
     * pointless, above the ceiling a full mesh stops being viable.
     */
    public function meetMaxPeers(): int
    {
        $raw = AppSetting::getValue(SettingKeys::MEET_MAX_PEERS, '');
        $value = is_numeric($raw) ? (int) $raw : self::DEFAULT_MEET_MAX_PEERS;
        if ($value <= 0) {
            $value = self::DEFAULT_MEET_MAX_PEERS;
        }

        return max(self::MIN_MEET_MAX_PEERS, min(self::MAX_MEET_MAX_PEERS, $value));
    }

    public function turnSecret(): string
    {
        return trim((string) AppSetting::getValue(SettingKeys::RTC_TURN_SECRET, ''));
    }

    public function turnAvailable(): bool
    {
        return $this->turnSecret() !== '' && $this->turnUrls() !== [];
    }

    /** Admin warning: leftover static credentials that no longer do anything. */
    public function legacyStaticCredentialsPresent(): bool
    {
        foreach ([self::LEGACY_TURN_USERNAME_KEY, self::LEGACY_TURN_CREDENTIAL_KEY] as $key) {
            if (trim((string) AppSetting::getValue($key, '')) !== '') {
                return true;
            }
        }

        return false;
    }

    public function forgetLegacyStaticCredentials(): void
    {
        AppSetting::query()
            ->whereIn('name', [self::LEGACY_TURN_USERNAME_KEY, self::LEGACY_TURN_CREDENTIAL_KEY])
            ->delete();
    }

    private function normalizeRtcUrls(mixed $value, string $defaultScheme): string
    {
        if (! is_string($value)) {
            return '';
        }
        $parts = array_filter(
            array_map(
                static fn (string $piece): string => self::normalizeRtcUrl($piece, $defaultScheme),
                preg_split('/[\r\n,]+/', $value) ?: []
            ),
            static fn (string $piece): bool => $piece !== ''
        );

        return implode(', ', $parts);
    }

    private static function normalizeRtcUrl(string $value, string $defaultScheme): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }
        if (preg_match('/^(stun|stuns|turn|turns):/i', $trimmed) === 1) {
            return $trimmed;
        }

        return $defaultScheme.':'.$trimmed;
    }
}
