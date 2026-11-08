<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Teams\TeamColleagues;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;

/**
 * Persists JMAP Calendar shareWith through Sabre CalPDO::updateInvites / getInvites.
 */
final class CalendarShareInvites
{
    public function __construct(
        private readonly CalDavCollections $collections,
        private readonly WgwCalendarBackendFactory $backends,
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly TeamColleagues $colleagues,
    ) {}

    public function canShare(CalendarInstance $instance, ?string $groupSlug): bool
    {
        // Personal owners and group members both sit on ACCESS_SHAREDOWNER.
        // $groupSlug is unused: membership is already resolved onto this instance.
        return (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER) === SharingPlugin::ACCESS_SHAREDOWNER;
    }

    public function isReadOnly(CalendarInstance $instance): bool
    {
        return (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER) === SharingPlugin::ACCESS_READ;
    }

    /** Inbound ACL sharee (read or write) — not the collection owner / group manager. */
    public function isSharee(CalendarInstance $instance): bool
    {
        $access = (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER);

        return $access === SharingPlugin::ACCESS_READ || $access === SharingPlugin::ACCESS_READWRITE;
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
        foreach ($this->backends->calBackend()->getInvites($this->collections->backendId($instance)) as $sharee) {
            if ((int) $sharee->access === SharingPlugin::ACCESS_SHAREDOWNER) {
                continue;
            }
            // An invite no principal matched grants nothing (Sabre marks it invalid).
            if ((int) $sharee->inviteStatus === SharingPlugin::INVITE_INVALID) {
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

    /**
     * `$caller` is the signed-in user. A sharee who shares no Team with the caller, or a Team
     * the caller is not in, is refused exactly like an unknown principal (Epic #1915).
     */
    public function apply(CalendarInstance $instance, ?string $groupSlug, mixed $shareWith, string $caller): void
    {
        if (! $this->canShare($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'Only collection administrators can change sharing.', 'forbidden');
        }

        $currentInvites = array_values($this->backends->calBackend()->getInvites($this->collections->backendId($instance)));
        $sharees = $shareWith === null
            ? $this->revokeAllSharees($currentInvites)
            : $this->shareesFromPatch($instance, $shareWith, $currentInvites, $caller);

        if ($sharees === []) {
            return;
        }

        $backend = $this->backends->calBackend();
        $backendId = $this->collections->backendId($instance);
        $stale = $this->principalLessHrefsBeingGranted($currentInvites, $sharees);
        if ($stale !== []) {
            // Sabre updates a principal-less row in place and keeps it principal-less. Drop it
            // first so the grant below inserts a fresh row carrying the principal.
            $backend->updateInvites($backendId, array_map(
                static fn (string $href): Sharee => new Sharee(['href' => $href, 'access' => SharingPlugin::ACCESS_NOACCESS]),
                $stale,
            ));
        }
        $backend->updateInvites($backendId, $sharees);
    }

    /**
     * @param  list<Sharee>  $currentInvites
     * @param  list<Sharee>  $sharees
     * @return list<string>
     */
    private function principalLessHrefsBeingGranted(array $currentInvites, array $sharees): array
    {
        $granted = [];
        foreach ($sharees as $sharee) {
            if ((int) $sharee->access !== SharingPlugin::ACCESS_NOACCESS && is_string($sharee->principal)) {
                $granted[(string) $sharee->href] = true;
            }
        }

        $stale = [];
        foreach ($currentInvites as $invite) {
            $href = (string) $invite->href;
            if (isset($granted[$href]) && (int) $invite->access !== SharingPlugin::ACCESS_SHAREDOWNER
                && (! is_string($invite->principal) || $invite->principal === '')) {
                $stale[$href] = $href;
            }
        }

        return array_values($stale);
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
    private function shareesFromPatch(CalendarInstance $instance, mixed $shareWith, array $currentInvites, string $caller): array
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
            // An owner can always take access away from a sharee who already holds a grant.
            $revokesExisting = $grant === null && $this->holdsInvite($currentInvites, (string) $principal->uri);
            if (! $revokesExisting && ! $this->colleagues->mayShareWithPrincipalUri($caller, (string) $principal->uri)) {
                $invalid[] = 'shareWith/'.$id;

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
    private function holdsInvite(array $currentInvites, string $principalUri): bool
    {
        foreach ($currentInvites as $invite) {
            if ((string) $invite->principal === $principalUri) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<Sharee>  $currentInvites
     */
    private function hrefForPrincipal(Principal $principal, array $currentInvites): string
    {
        foreach ($currentInvites as $invite) {
            if ((string) $invite->principal === (string) $principal->uri && $invite->href !== '') {
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

        $href = $sharee->href;

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
}
