<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CalendarColorPalette;
use App\Services\Projects\ProjectRegistry;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * A Project collection's name and color are the Project's (#817 B1, spec "Guards on
 * Project collections"): an owner-side PROPPATCH of `{DAV:}displayname` or the color
 * answers 403 for that property in the 207. Other properties keep working, and a
 * sharee still renames and recolors their own copy.
 *
 * Runs before the node's own handler (Sabre's CorePlugin updates the node at 200).
 * Server-side writes (`PATCH /projects` writing through) go to the backend directly
 * and never pass here.
 */
final class ProjectCollectionPropPatchPlugin extends ServerPlugin
{
    private const PROPERTIES = ['{DAV:}displayname', CalendarColorPalette::PROPERTY];

    private Server $server;

    public function __construct(private readonly ProjectRegistry $projects) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('propPatch', [$this, 'propPatch'], 150);
    }

    public function getPluginName(): string
    {
        return 'wgw-project-collection-proppatch';
    }

    public function propPatch(string $path, PropPatch $propPatch): void
    {
        $touched = array_values(array_intersect(self::PROPERTIES, array_keys($propPatch->getMutations())));
        if ($touched === [] || ! str_starts_with(trim($path, '/'), 'calendars/')) {
            return;
        }
        $node = $this->server->tree->getNodeForPath($path);
        if (! $node instanceof AppSharedCalendar
            || in_array($node->getShareAccess(), [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE], true)
            || ! $this->projects->isProjectCollection($node->collectionId())) {
            return;
        }

        $propPatch->handle($touched, static fn (): array => array_fill_keys($touched, 403));
    }
}
