<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;

/**
 * Persists JMAP Calendar shareWith through Sabre CalPDO::updateInvites / getInvites.
 */
final class CalendarShareInvites
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
    ) {}

    public function canShare(CalendarInstance $instance, ?string $groupSlug): bool
    {
        return $groupSlug === null
            && (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER) === SharingPlugin::ACCESS_SHAREDOWNER;
    }

    public function isReadOnly(CalendarInstance $instance): bool
    {
        return (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER) === SharingPlugin::ACCESS_READ;
    }

    /**
     * @return array<string, array{mayRead: bool, mayWrite: bool, mayShare: bool, mayDelete: bool}>|null
     */
    public function shareWithForOwner(CalendarInstance $instance, ?string $groupSlug): ?array
    {
        if (! $this->canShare($instance, $groupSlug)) {
            return null;
        }

        $grants = [];
        foreach ($this->calBackend()->getInvites($this->backendId($instance)) as $sharee) {
            if ((int) $sharee->access === SharingPlugin::ACCESS_SHAREDOWNER) {
                continue;
            }
            $id = $this->jmapIdForSharee($sharee);
            if ($id === null) {
                continue;
            }
            $grants[$id] = $this->restRightsForAccess((int) $sharee->access);
        }

        return $grants === [] ? null : $grants;
    }

    public function apply(CalendarInstance $instance, ?string $groupSlug, mixed $shareWith): void
    {
        if (! $this->canShare($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'Only the personal calendar owner can change sharing.', 'forbidden');
        }

        $currentInvites = $this->calBackend()->getInvites($this->backendId($instance));
        $sharees = $shareWith === null
            ? $this->revokeAllSharees($currentInvites)
            : $this->shareesFromPatch($instance, $shareWith, $currentInvites);

        if ($sharees === []) {
            return;
        }

        $this->calBackend()->updateInvites($this->backendId($instance), $sharees);
    }

    /**
     * @param  list<Sharee>  $currentInvites
     * @return list<Sharee>
     */
    private function revokeAllSharees(array $currentInvites): array
    {
        $sharees = [];
        foreach ($currentInvites as $invite) {
            if ((int) $invite->access === SharingPlugin::ACCESS_SHAREDOWNER) {
                continue;
            }
            $sharees[] = new Sharee([
                'href' => (string) $invite->href,
                'access' => SharingPlugin::ACCESS_NOACCESS,
            ]);
        }

        return $sharees;
    }

    /**
     * @param  list<Sharee>  $currentInvites
     * @return list<Sharee>
     */
    private function shareesFromPatch(CalendarInstance $instance, mixed $shareWith, array $currentInvites): array
    {
        if (! is_array($shareWith)) {
            throw new ApiHttpException(400, 'shareWith must be an object or null.', 'invalidProperties', ['shareWith']);
        }

        $sharees = [];
        $invalid = [];
        foreach ($shareWith as $id => $grant) {
            if (! is_string($id) || $id === '') {
                $invalid[] = 'shareWith';

                continue;
            }
            $principal = $this->addresses->principalForJmapId($id);
            if ($principal === null) {
                $invalid[] = 'shareWith/'.$id;

                continue;
            }
            if ((string) $principal->uri === (string) $instance->principaluri) {
                continue;
            }
            if ($grant === null) {
                $sharees[] = new Sharee([
                    'href' => $this->hrefForPrincipal($principal, $currentInvites),
                    'principal' => (string) $principal->uri,
                    'access' => SharingPlugin::ACCESS_NOACCESS,
                ]);

                continue;
            }
            if (! is_array($grant)) {
                $invalid[] = 'shareWith/'.$id;

                continue;
            }
            $sharees[] = new Sharee([
                'href' => $this->hrefForPrincipal($principal, $currentInvites),
                'principal' => (string) $principal->uri,
                'access' => $this->accessFromRights($grant),
                'properties' => [
                    '{DAV:}displayname' => is_string($principal->displayname) ? $principal->displayname : $id,
                ],
            ]);
        }

        if ($invalid !== []) {
            throw new ApiHttpException(400, 'Unknown or invalid share principal.', 'invalidProperties', $invalid);
        }

        return $sharees;
    }

    /**
     * @param  list<Sharee>  $currentInvites
     */
    private function hrefForPrincipal(Principal $principal, array $currentInvites): string
    {
        foreach ($currentInvites as $invite) {
            if ((string) $invite->principal === (string) $principal->uri && is_string($invite->href) && $invite->href !== '') {
                return $invite->href;
            }
        }

        return $this->addresses->shareHrefForPrincipal($principal);
    }

    private function jmapIdForSharee(Sharee $sharee): ?string
    {
        $principalUri = is_string($sharee->principal) ? $sharee->principal : null;
        $fromPrincipal = $principalUri !== null ? $this->addresses->jmapIdForPrincipalUri($principalUri) : null;
        if ($fromPrincipal !== null) {
            return $fromPrincipal;
        }

        $href = is_string($sharee->href) ? $sharee->href : '';

        return $this->addresses->jmapIdForShareHref($href);
    }

    /**
     * @param  array<string, mixed>  $rights
     */
    private function accessFromRights(array $rights): int
    {
        $mayWriteAll = ($rights['mayWriteAll'] ?? false) === true
            || ($rights['mayWrite'] ?? false) === true;

        return $mayWriteAll ? SharingPlugin::ACCESS_READWRITE : SharingPlugin::ACCESS_READ;
    }

    /**
     * @return array{mayRead: bool, mayWrite: bool, mayShare: bool, mayDelete: bool}
     */
    private function restRightsForAccess(int $access): array
    {
        return [
            'mayRead' => true,
            'mayWrite' => $access === SharingPlugin::ACCESS_READWRITE,
            'mayShare' => false,
            'mayDelete' => false,
        ];
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function backendId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
