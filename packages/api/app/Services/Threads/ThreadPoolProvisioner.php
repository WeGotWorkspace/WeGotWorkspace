<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Database\QueryException;
use PDOException;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Find-or-create the DAV-hidden VJOURNAL pool of one owner for one subject
 * type (#2173). The same pattern as the Docs pool: no shares, access comes
 * from the subject type only.
 */
final class ThreadPoolProvisioner
{
    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollections,
        private readonly WgwCalendarBackendFactory $backends,
    ) {}

    public function ensure(string $subjectType, string $ownerUri): CalendarInstance
    {
        $existing = $this->find($subjectType, $ownerUri);
        if ($existing !== null) {
            return $existing;
        }

        if (str_starts_with($ownerUri, AdminConstants::GROUP_PREFIX)) {
            $slug = substr($ownerUri, strlen(AdminConstants::GROUP_PREFIX));
            $group = Principal::query()->where('uri', $ownerUri)->first(['uri', 'displayname']);
            $this->calendarCollections->ensureForGroupPrincipal($ownerUri, (string) ($group->displayname ?? $slug));
        } else {
            $this->calendarCollections->ensureForPrincipal($ownerUri);
        }

        try {
            $this->backends->make()->createCollection(CollectionKind::ThreadPool, $ownerUri, ThreadPoolUris::forType($subjectType), [
                '{DAV:}displayname' => 'Threads',
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
            ]);
        } catch (QueryException|PDOException) {
            $raced = $this->find($subjectType, $ownerUri);
            if ($raced !== null) {
                return $raced;
            }
            throw new ApiHttpException(500, 'Could not provision thread storage.', 'server_error');
        }

        return $this->find($subjectType, $ownerUri)
            ?? throw new ApiHttpException(500, 'Could not load thread storage.', 'server_error');
    }

    public function find(string $subjectType, string $ownerUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('principaluri', $ownerUri)
            ->where('uri', ThreadPoolUris::forType($subjectType))
            ->whereHas('calendar', fn ($query) => $query->ofKind(CollectionKind::ThreadPool))
            ->first();
    }
}
