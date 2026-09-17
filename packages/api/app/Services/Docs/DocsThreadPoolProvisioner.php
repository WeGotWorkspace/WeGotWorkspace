<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDOException;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Find-or-create the DAV-hidden docs-threads VJOURNAL pool for a file owner.
 */
final class DocsThreadPoolProvisioner
{
    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollections,
    ) {}

    public function ensureForOwner(string $principalUri): CalendarInstance
    {
        $existing = $this->findPool($principalUri);
        if ($existing !== null) {
            return $existing;
        }

        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));
            $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
            $this->calendarCollections->ensureForGroupPrincipal(
                $principalUri,
                (string) ($group?->displayname ?? $slug),
            );
        } else {
            $this->calendarCollections->ensureForPrincipal($principalUri);
        }

        try {
            $this->calBackend()->createCalendar($principalUri, DocsThreadCollectionUris::POOL_URI, [
                '{DAV:}displayname' => 'Docs threads',
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
            ]);
        } catch (QueryException|PDOException) {
            $raced = $this->findPool($principalUri);
            if ($raced !== null) {
                return $raced;
            }
            throw new ApiHttpException(500, 'Could not provision docs thread storage.', 'server_error');
        }

        $instance = $this->findPool($principalUri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load docs thread storage.', 'server_error');
        }

        return $instance;
    }

    public function findPool(string $principalUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', DocsThreadCollectionUris::POOL_URI)
            ->first();
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
