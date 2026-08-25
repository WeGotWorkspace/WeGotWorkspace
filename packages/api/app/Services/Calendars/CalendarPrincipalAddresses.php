<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use Illuminate\Database\Eloquent\Builder;

/**
 * Maps instance users to iTIP calendar-user addresses.
 *
 * Local delivery matches {@code principals.email} (including invalid or
 * {@code user@localhost} values) and the username ({@code mailto:wouter}
 * from a username-only picker). A bad mailbox is not treated as external.
 */
final class CalendarPrincipalAddresses
{
    /**
     * @return list<string>
     */
    public function addressesForUsername(string $username): array
    {
        $principal = Principal::forUsername($username);

        return $principal !== null ? $this->addressesForPrincipal($principal) : [];
    }

    /**
     * @return list<string>
     */
    public function addressesForPrincipal(Principal $principal): array
    {
        $addresses = [];
        $email = $this->normalizedEmail($principal->email);
        if ($email !== null) {
            $addresses[] = 'mailto:'.$email;
        }
        $username = $this->usernameFromUri((string) $principal->uri);
        if ($username !== null) {
            $local = 'mailto:'.$username;
            if (! in_array($local, $addresses, true)) {
                $addresses[] = $local;
            }
        }

        return $addresses;
    }

    public function principalForMailto(string $mailto): ?Principal
    {
        $raw = $this->stripMailto($mailto);
        if ($raw === null) {
            return null;
        }

        // Match the stored profile value even when it is not a usable mailbox
        // (username-shaped garbage, empty-domain, etc.). Invalid email must not
        // hide a local principal from iTIP.
        $byEmail = $this->userPrincipalQuery()
            ->whereRaw('lower(email) = ?', [$raw])
            ->first();
        if ($byEmail !== null) {
            return $byEmail;
        }

        $email = $this->normalizedEmail($raw);
        if ($email !== null) {
            $username = $this->localUsernameIfLocalDomain($email);
            if ($username !== null) {
                $byUsername = Principal::forUsername($username);
                if ($byUsername !== null) {
                    return $byUsername;
                }
            }
        }

        if (str_starts_with($raw, 'groups/')) {
            return Principal::query()->where('uri', AdminConstants::GROUP_PREFIX.substr($raw, strlen('groups/')))->first();
        }

        if ($this->isUsername($raw)) {
            return Principal::forUsername($raw);
        }

        return null;
    }

    /**
     * CalDAV share_href: profile email, else mailto:{username}, else mailto:groups/{slug}.
     */
    public function shareHrefForPrincipal(Principal $principal): string
    {
        $canonical = $this->canonicalCalendarUserAddress($principal);
        if ($canonical !== null) {
            return 'mailto:'.$canonical;
        }
        $jmapId = $this->jmapIdForPrincipalUri((string) $principal->uri);
        if ($jmapId !== null) {
            return 'mailto:'.$jmapId;
        }

        throw new \InvalidArgumentException('Cannot build a mailto: share href for '.$principal->uri);
    }

    public function jmapIdForPrincipalUri(string $uri): ?string
    {
        $username = $this->usernameFromUri($uri);
        if ($username !== null) {
            return $username;
        }
        $slug = $this->groupSlugFromUri($uri);

        return $slug !== null ? 'groups/'.$slug : null;
    }

    public function principalForJmapId(string $id): ?Principal
    {
        $id = strtolower(trim($id));
        if ($id === '') {
            return null;
        }
        if (str_starts_with($id, 'groups/')) {
            $slug = substr($id, strlen('groups/'));

            return $slug !== ''
                ? Principal::query()->where('uri', AdminConstants::GROUP_PREFIX.$slug)->first()
                : null;
        }

        return Principal::forUsername($id);
    }

    public function jmapIdForShareHref(string $href): ?string
    {
        $principal = $this->principalForMailto($href);
        if ($principal !== null) {
            return $this->jmapIdForPrincipalUri((string) $principal->uri);
        }
        $raw = $this->stripMailto($href);
        if ($raw !== null && str_starts_with($raw, 'groups/')) {
            return $raw;
        }

        return null;
    }

    /**
     * Address to advertise / persist for a local user: usable email, else username.
     */
    public function canonicalCalendarUserAddress(Principal $principal): ?string
    {
        $addresses = $this->addressesForPrincipal($principal);

        return $addresses !== [] ? $this->calendarUserAddress($addresses[0]) : null;
    }

    public function normalizedEmail(mixed $value): ?string
    {
        $email = $this->stripMailto($value);
        if ($email === null || ! str_contains($email, '@') || ! $this->isPlausibleEmail($email)) {
            return null;
        }

        return $email;
    }

    /**
     * Calendar-user address without the {@code mailto:} prefix (email or username).
     */
    public function calendarUserAddress(mixed $value): ?string
    {
        $email = $this->normalizedEmail($value);
        if ($email !== null) {
            return $email;
        }
        $raw = $this->stripMailto($value);

        return $raw !== null && $this->isUsername($raw) ? $raw : null;
    }

    private function stripMailto(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $raw = strtolower(trim($value));
        if (str_starts_with($raw, 'mailto:')) {
            $raw = substr($raw, 7);
        }

        return $raw !== '' ? $raw : null;
    }

    private function isPlausibleEmail(string $email): bool
    {
        if (preg_match('/^[^@\s]+@[^@\s]+$/', $email) !== 1) {
            return false;
        }
        [$local, $domain] = explode('@', $email, 2);

        return $local !== '' && $domain !== '';
    }

    private function isUsername(string $value): bool
    {
        return preg_match('/^[a-z0-9][a-z0-9._-]*$/', $value) === 1;
    }

    private function localUsernameIfLocalDomain(string $email): ?string
    {
        [$local, $domain] = explode('@', $email, 2);
        if (! in_array($domain, ['localhost', 'local', 'invalid'], true)) {
            return null;
        }

        return $this->isUsername($local) ? $local : null;
    }

    private function usernameFromUri(string $uri): ?string
    {
        if (! str_starts_with($uri, 'principals/') || str_starts_with($uri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }
        $username = substr($uri, strlen('principals/'));
        if ($username === '' || str_contains($username, '/')) {
            return null;
        }

        return strtolower($username);
    }

    private function groupSlugFromUri(string $uri): ?string
    {
        if (! str_starts_with($uri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }
        $slug = substr($uri, strlen(AdminConstants::GROUP_PREFIX));

        return $slug !== '' ? $slug : null;
    }

    /**
     * @return Builder<Principal>
     */
    private function userPrincipalQuery(): Builder
    {
        return Principal::query()
            ->where('uri', 'like', 'principals/%')
            ->where('uri', 'not like', 'principals/groups/%');
    }
}
