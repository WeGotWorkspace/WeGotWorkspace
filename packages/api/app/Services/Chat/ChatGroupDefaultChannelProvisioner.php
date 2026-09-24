<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\PropPatch;

/**
 * Every ACL group gets exactly one default chat channel (Epic #701 chunk M).
 *
 * The channel is a VJOURNAL collection owned by the group principal itself
 * (`principals/groups/{slug}`), exactly like group notebooks/task lists —
 * membership follows group membership automatically through
 * CalendarCollectionAccess, with no share invites to maintain. The uri is
 * deterministic (ChatCollectionUris::groupDefaultUri) so provisioning is a
 * cheap find-or-create and the room-id convention (room = channel id) holds.
 *
 * Trigger points:
 * - lazily from ChatChannelRepository::accessibleChatInstances on every
 *   channel read (REST list/changes, JMAP get/changes/state fan-out) — this
 *   covers pre-existing groups with zero admin migration, mirroring how
 *   UserCalendarCollectionsProvisioner::ensureForGroupPrincipal lazily
 *   provisions group calendars from CalendarCollectionAccess;
 * - eagerly from AdminGroupManagementService::create for new groups.
 *
 * The channel display name tracks the group's display name: renames are
 * blocked on the channel itself (default channels are immutable through the
 * generic endpoints, like DMs), and ensure() re-syncs the name through the
 * Sabre backend whenever the group was renamed — so the update also surfaces
 * on the changes feed.
 *
 * Group deletion needs no hook: AdminGroupManagementService::delete removes
 * every DAV collection owned by the group principal, chat_channel_meta
 * cascades with the calendars row.
 */
final class ChatGroupDefaultChannelProvisioner
{
    /**
     * Ensure the default channel exists (and carries the group's current
     * display name) for each of the given group slugs.
     *
     * @param  list<string>  $slugs
     */
    public function ensureForGroupSlugs(array $slugs): void
    {
        if ($slugs === []) {
            return;
        }

        $groups = Principal::query()
            ->whereIn('uri', array_map(
                static fn (string $slug): string => AdminConstants::GROUP_PREFIX.$slug,
                $slugs,
            ))
            ->get(['uri', 'displayname']);
        if ($groups->isEmpty()) {
            return;
        }

        $uriBySlug = [];
        foreach ($groups as $group) {
            $slug = substr((string) $group->uri, strlen(AdminConstants::GROUP_PREFIX));
            if ($slug !== '') {
                $uriBySlug[$slug] = ChatCollectionUris::groupDefaultUri($slug);
            }
        }
        if ($uriBySlug === []) {
            return;
        }

        // One existence probe for all groups — this is the hot path (every
        // channel list / JMAP poll); the transaction below only runs on miss.
        $existingByUri = CalendarInstance::query()
            ->whereIn('uri', array_values($uriBySlug))
            ->get(['id', 'calendarid', 'principaluri', 'uri', 'displayname'])
            ->keyBy('uri');

        foreach ($groups as $group) {
            $groupUri = (string) $group->uri;
            $slug = substr($groupUri, strlen(AdminConstants::GROUP_PREFIX));
            $uri = $uriBySlug[$slug] ?? null;
            if ($uri === null) {
                continue;
            }
            $name = trim((string) ($group->displayname ?? '')) ?: $slug;

            $instance = $existingByUri->get($uri);
            if ($instance === null) {
                $this->provision($groupUri, $slug, $uri, $name);
            } elseif ((string) $instance->principaluri === $groupUri) {
                $this->syncDisplayName($instance, $name);
            }
            // else: the deterministic uri exists under a foreign principal —
            // someone claimed it via the client-supplied-id create path before
            // the group default was ever provisioned. Channel ids are globally
            // unique (allocateChannelUri), so we cannot create; leave the
            // squatter untouched rather than hijack or delete a user's channel.
        }
    }

    private function provision(string $groupPrincipalUri, string $slug, string $uri, string $displayName): void
    {
        try {
            DB::connection('wgw')->transaction(function () use ($groupPrincipalUri, $slug, $uri, $displayName): void {
                // Serialize concurrent first-reads per group (openDm precedent:
                // lock the principal row, re-check, create).
                Principal::query()->where('uri', $groupPrincipalUri)->lockForUpdate()->get();
                if (CalendarInstance::query()->where('uri', $uri)->exists()) {
                    return;
                }

                $this->calBackend()->createCalendar($groupPrincipalUri, $uri, [
                    '{DAV:}displayname' => $displayName,
                    '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
                ]);

                $instance = CalendarInstance::query()
                    ->where('principaluri', $groupPrincipalUri)
                    ->where('uri', $uri)
                    ->first(['calendarid']);
                if ($instance === null) {
                    return;
                }

                ChatChannelMeta::query()->create([
                    'calendarid' => (int) $instance->calendarid,
                    'kind' => ChatChannelMeta::KIND_CHANNEL,
                    'default_for_group' => $slug,
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            // Lost a create race (calendarinstances (principaluri, uri) or the
            // chat_channel_meta.default_for_group unique index): the winner
            // provisioned the channel — find-or-create semantics, not an error.
        }
    }

    /**
     * Group renamed since provisioning: re-point the channel display name at
     * the group's current name — through the Sabre backend so the synctoken
     * bumps and the change surfaces on the normal changes feed.
     */
    private function syncDisplayName(CalendarInstance $instance, string $displayName): void
    {
        if (trim((string) ($instance->displayname ?? '')) === $displayName) {
            return;
        }

        $propPatch = new PropPatch(['{DAV:}displayname' => $displayName]);
        $this->calBackend()->updateCalendar([(int) $instance->calendarid, (int) $instance->id], $propPatch);
        $propPatch->commit();
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
