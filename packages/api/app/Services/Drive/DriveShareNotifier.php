<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Events\EventDispatch;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Services\Admin\AdminConstants;
use App\Services\Notify\DocsSharedNotify;

/**
 * Notifies new member sharees after a share is created or its grants change.
 */
final class DriveShareNotifier
{
    public function __construct(
        private EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /**
     * @param  list<string>|null  $onlyUsernames  when set, notify only these sharees (update delta)
     */
    public function notifySharees(string $actor, DriveShare $share, ?array $onlyUsernames = null): void
    {
        $path = (string) $share->path;
        $recipients = $onlyUsernames ?? $this->shareeUsernames($share);
        if ($onlyUsernames !== null) {
            $allowed = array_fill_keys($this->shareeUsernames($share), true);
            $recipients = array_values(array_filter(
                $onlyUsernames,
                static fn (string $username): bool => isset($allowed[strtolower($username)]),
            ));
        }
        if ($recipients === []) {
            return;
        }
        $this->eventDispatch->fireMutation(
            $actor,
            'docs',
            'shared',
            $path,
            [
                'recipients' => $recipients,
                ...DocsSharedNotify::eventData(
                    DocsSharedNotify::actorLabel($actor),
                    $path,
                    (string) $share->id,
                ),
                'path' => $path,
            ],
        );
    }

    /**
     * @return list<string>
     */
    public function shareeUsernames(DriveShare $share): array
    {
        $usernames = [];
        foreach (DriveShareGrant::query()->where('share_id', $share->id)->get() as $grant) {
            $type = (string) $grant->grantee_type;
            if ($type === 'user' && is_string($grant->grantee_user) && $grant->grantee_user !== '') {
                $usernames[strtolower($grant->grantee_user)] = true;
            }
            if ($type === 'group' && is_string($grant->grantee_group) && $grant->grantee_group !== '') {
                foreach ($this->usernamesForGroupSlug($grant->grantee_group) as $username) {
                    $usernames[strtolower($username)] = true;
                }
            }
        }

        return array_keys($usernames);
    }

    /**
     * @return list<string>
     */
    private function usernamesForGroupSlug(string $slug): array
    {
        $uri = AdminConstants::GROUP_PREFIX.$slug;

        return array_values(GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', $uri)
            ->pluck('m.uri')
            ->map(static fn (mixed $uri): string => str_replace('principals/', '', (string) $uri))
            ->all());
    }
}
