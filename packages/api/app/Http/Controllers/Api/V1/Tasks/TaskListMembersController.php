<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Tasks;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Tasks\TaskAssigneeGuard;
use App\Services\Tasks\TaskListAudience;
use App\Services\Tasks\TaskListRepository;
use App\Services\Teams\TeamColleagues;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The people the assignee picker offers for a task list (#2172).
 *
 * Only someone who can edit the list may ask: they are the only people who
 * can assign. The list is the list audience, narrowed to people the caller
 * shares a Team with (Epic #1915), plus the caller and the list owner, so a
 * person sharee does not learn the members of a Team they are not in.
 * {@see TaskAssigneeGuard} applies the same rule to writes.
 */
final class TaskListMembersController
{
    public function __construct(
        private readonly TaskListRepository $taskLists,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly TaskListAudience $audience,
        private readonly TeamColleagues $colleagues,
    ) {}

    public function __invoke(Request $request, string $taskListId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $caller = strtolower((string) $principal['username']);

        $list = $this->taskLists->findAccessibleTaskList($caller, $taskListId);
        if ($list === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($list, 'Only people who can edit this task list can assign people.');

        $alwaysShown = array_flip([$caller, ...$this->audience->ownerUsernames($list)]);
        $members = [];
        foreach ($this->audience->forList($list) as $username => $member) {
            if (isset($alwaysShown[$username]) || $this->colleagues->sharesTeamIgnoringAdminRole($caller, $username)) {
                $members[] = $member;
            }
        }

        return response()->json(['list' => $members]);
    }
}
