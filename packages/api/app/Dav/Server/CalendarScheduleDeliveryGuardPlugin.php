<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CalendarSchedulingDeliveryPolicy;
use App\Services\Calendars\CalendarSchedulingObjects;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\DAVACL\Plugin as AclPlugin;
use Sabre\VObject\ITip\Message;

/**
 * CalDAV local delivery guard. Sabre's Schedule plugin updates whatever object
 * the recipient owns with the message UID (`CalDAV\Backend\PDO::getCalendarObjectByUID()`
 * only matches instances with access 1, so calendars shared to the recipient
 * are never updated and a new copy goes to an owned default calendar). The
 * guard inspects that same owned set (and instances without an access value).
 * It runs first and stops delivery to a recipient whose existing object is not
 * the matching scheduling object (see {@see CalendarSchedulingDeliveryPolicy});
 * that object stays as it is, the message gets schedule status 3.8 (no
 * authority, RFC 5546) and the skip is logged.
 */
final class CalendarScheduleDeliveryGuardPlugin extends ServerPlugin
{
    /** Sabre registers scheduleLocalDelivery at the default priority 100. */
    private const PRIORITY = 90;

    private ?Server $server = null;

    public function __construct(
        private readonly CalendarSchedulingObjects $objects,
        private readonly CalendarSchedulingDeliveryPolicy $policy,
    ) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('schedule', [$this, 'beforeLocalDelivery'], self::PRIORITY);
    }

    public function getPluginName(): string
    {
        return 'wgw-schedule-delivery-guard';
    }

    public function beforeLocalDelivery(Message $message): ?bool
    {
        $acl = $this->server?->getPlugin('acl');
        if (! $acl instanceof AclPlugin) {
            return null;
        }
        $principalUri = $acl->getPrincipalByUri((string) $message->recipient);
        if (! is_string($principalUri) || $principalUri === '') {
            return null;
        }

        foreach ($this->objects->ownedByPrincipal($principalUri, (string) $message->uid) as $candidate) {
            if (! $this->policy->allows($message, $principalUri, $this->objects->parse($candidate['object']))) {
                $message->scheduleStatus = '3.8;No authority to change the existing object with this UID.';
                $this->policy->logSkipped($message, $principalUri);

                return false;
            }
        }

        return null;
    }
}
