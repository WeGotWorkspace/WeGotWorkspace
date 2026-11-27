<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability\PublicLink;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarAvailabilityLink;
use App\Models\CalendarFeedToken;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Support\ApiUrlBuilder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * The owner's side of the public availability link: turn on, read, make a new
 * link, turn off. One link per person. Turning on while on returns the same
 * link; only {@see regenerate()} replaces the token, and it replaces it in one
 * update, so the old token exists nowhere afterwards.
 */
final class AvailabilityPublicLinkService
{
    public function __construct(private readonly ApiUrlBuilder $urls) {}

    /**
     * @return array{enabled: bool, httpsUrl?: string, webcalUrl?: string}
     */
    public function show(string $username): array
    {
        $row = $this->rowOf($username);

        return $row === null ? ['enabled' => false] : $this->payload($row);
    }

    /**
     * @return array{created: bool, link: array{enabled: bool, httpsUrl?: string, webcalUrl?: string}}
     */
    public function enable(string $username): array
    {
        $existing = $this->rowOf($username);
        if ($existing !== null) {
            return ['created' => false, 'link' => $this->payload($existing)];
        }

        $raw = self::newToken();
        $row = CalendarAvailabilityLink::query()->create([
            'principal_uri' => AvailabilitySettings::principalUri($username),
            'token_hash' => CalendarFeedToken::hashRaw($raw),
            'token_cipher' => $raw,
            'created_at' => self::now(),
            'rotated_at' => null,
        ]);

        return ['created' => true, 'link' => $this->payload($row, $raw)];
    }

    /**
     * @return array{enabled: bool, httpsUrl?: string, webcalUrl?: string}
     */
    public function regenerate(string $username): array
    {
        $row = $this->rowOf($username);
        if ($row === null) {
            throw new ApiHttpException(409, 'The public availability link is off.', 'conflict');
        }
        $raw = self::newToken();
        // One save replaces hash and cipher together: the old token is gone at once.
        $row->token_hash = CalendarFeedToken::hashRaw($raw);
        $row->token_cipher = $raw;
        $row->rotated_at = self::now();
        $row->save();

        return $this->payload($row, $raw);
    }

    public function disable(string $username): void
    {
        CalendarAvailabilityLink::query()
            ->where('principal_uri', AvailabilitySettings::principalUri($username))
            ->delete();
    }

    private function rowOf(string $username): ?CalendarAvailabilityLink
    {
        return CalendarAvailabilityLink::query()
            ->where('principal_uri', AvailabilitySettings::principalUri($username))
            ->first();
    }

    /**
     * @return array{enabled: bool, httpsUrl: string, webcalUrl: string}
     */
    private function payload(CalendarAvailabilityLink $row, ?string $raw = null): array
    {
        $raw ??= (string) $row->token_cipher;
        if ($raw === '') {
            throw new ApiHttpException(500, 'The public availability link could not be read.', 'server_error');
        }
        $https = $this->urls->v1('calendars/availability/feeds/'.$raw);

        return [
            'enabled' => true,
            'httpsUrl' => $https,
            'webcalUrl' => (string) preg_replace('#^https?://#i', 'webcal://', $https),
        ];
    }

    private static function newToken(): string
    {
        return Str::lower(Str::random(48));
    }

    private static function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.u');
    }
}
