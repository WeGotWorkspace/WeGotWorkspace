<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CalendarSchedulingDeliveryPolicy;
use App\Services\Calendars\CalendarSchedulingObjects;
use App\Services\Calendars\CalendarSchedulingReach;
use Sabre\CalDAV\Schedule\Plugin;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
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
 *
 * It also stops local delivery to someone outside the sender's Teams
 * ({@see CalendarSchedulingReach}, #1923). That recipient gets exactly the
 * schedule status of an external address, which Sabre's local delivery sets
 * when it cannot find a principal. Nothing is sent: DAV has no iMIP route yet
 * (#1929). Principal lookup goes through the unfiltered principal backend, so
 * this runs before Sabre reaches the recipient through the node tree.
 */
final class CalendarScheduleDeliveryGuardPlugin extends ServerPlugin
{
    /** Sabre registers scheduleLocalDelivery at the default priority 100. */
    private const PRIORITY = 90;

    /** What {@see Plugin::scheduleLocalDelivery} sets for an external address. */
    public const EXTERNAL_ADDRESS_STATUS = '3.7;Could not find principal.';

    private ?Server $server = null;

    public function __construct(
        private readonly CalendarSchedulingObjects $objects,
        private readonly CalendarSchedulingDeliveryPolicy $policy,
        private readonly CalendarSchedulingReach $reach,
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
        if (! $this->reachesLocally($message, $principalUri)) {
            $message->scheduleStatus = self::EXTERNAL_ADDRESS_STATUS;

            return false;
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

    private function reachesLocally(Message $message, string $recipientUri): bool
    {
        $auth = $this->server?->getPlugin('auth');
        $sender = $auth instanceof AuthPlugin ? $auth->getCurrentPrincipal() : null;
        if (! is_string($sender) || ! str_starts_with($sender, 'principals/') || ! str_starts_with($recipientUri, 'principals/')) {
            return true;
        }

        return $this->reach->deliversLocally(
            substr($sender, strlen('principals/')),
            substr($recipientUri, strlen('principals/')),
            (string) $message->method,
        );
    }
}
