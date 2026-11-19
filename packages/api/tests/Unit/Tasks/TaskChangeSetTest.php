<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\TaskChangeSet;
use PHPUnit\Framework\TestCase;

/**
 * The pure task diff behind `tasks.assigned` and Epic #2173's activity log (#2172).
 */
final class TaskChangeSetTest extends TestCase
{
    public function test_identical_tasks_give_an_empty_set(): void
    {
        $changes = TaskChangeSet::between($this->task(), $this->task());

        $this->assertTrue($changes->isEmpty());
        $this->assertSame('task-1', $changes->taskId);
    }

    public function test_create_and_delete(): void
    {
        $created = TaskChangeSet::between(null, $this->task());
        $this->assertTrue($created->created);
        $this->assertFalse($created->deleted);
        $this->assertFalse($created->moved());

        $deleted = TaskChangeSet::between($this->task(), null);
        $this->assertTrue($deleted->deleted);
        $this->assertFalse($deleted->created);
        $this->assertSame('task-1', $deleted->taskId);
    }

    public function test_scalar_fields_report_from_and_to(): void
    {
        $changes = TaskChangeSet::between($this->task(), $this->task([
            'title' => 'Buy oat milk',
            'workflowStatus' => 'completed',
            'priority' => 1,
            'start' => '2026-11-20T09:00:00',
            'due' => '2026-11-21T09:00:00',
            'showWithoutTime' => true,
        ]));

        $this->assertSame(['from' => 'Buy milk', 'to' => 'Buy oat milk'], $changes->scalars['title']);
        $this->assertSame(['from' => 'needs-action', 'to' => 'completed'], $changes->scalars['workflowStatus']);
        $this->assertSame(['from' => null, 'to' => 1], $changes->scalars['priority']);
        $this->assertSame(['from' => null, 'to' => '2026-11-20T09:00:00'], $changes->scalars['start']);
        $this->assertSame(['from' => '2026-11-19T09:00:00', 'to' => '2026-11-21T09:00:00'], $changes->scalars['due']);
        $this->assertSame(['from' => false, 'to' => true], $changes->scalars['showWithoutTime']);
        $this->assertFalse($changes->changed('taskListId'));
    }

    public function test_whitespace_only_title_change_is_no_change(): void
    {
        $this->assertTrue(TaskChangeSet::between($this->task(), $this->task(['title' => ' Buy milk ']))->isEmpty());
    }

    public function test_categories_as_added_and_removed(): void
    {
        $changes = TaskChangeSet::between(
            $this->task(['categories' => ['home', 'shop']]),
            $this->task(['categories' => ['shop', 'urgent']]),
        );

        $this->assertSame(['urgent'], $changes->categoriesAdded);
        $this->assertSame(['home'], $changes->categoriesRemoved);
    }

    public function test_description_only_reports_that_it_changed(): void
    {
        $changes = TaskChangeSet::between($this->task(['description' => 'Old']), $this->task(['description' => 'New']));

        $this->assertTrue($changes->descriptionChanged);
        $this->assertSame([], $changes->scalars);
    }

    public function test_assignees_as_added_and_removed_ids_without_the_owner(): void
    {
        $changes = TaskChangeSet::between(
            $this->task(['participants' => [
                'org' => ['@type' => 'Participant', 'roles' => ['owner']],
                'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
                'e:guest@out.test' => ['@type' => 'Participant', 'roles' => ['attendee']],
            ]]),
            $this->task(['participants' => [
                'u:carol' => ['@type' => 'Participant', 'roles' => ['attendee']],
                'e:guest@out.test' => ['@type' => 'Participant', 'roles' => ['attendee']],
                'e:new@out.test' => ['@type' => 'Participant', 'roles' => ['attendee']],
            ]]),
        );

        $this->assertSame(['u:carol', 'e:new@out.test'], $changes->assigneesAdded);
        $this->assertSame(['u:alice'], $changes->assigneesRemoved);
        $this->assertSame(['carol'], $changes->addedAssigneeUsernames());
    }

    public function test_assignees_on_a_created_task_are_all_added(): void
    {
        $changes = TaskChangeSet::between(null, $this->task(['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]]));

        $this->assertSame(['alice'], $changes->addedAssigneeUsernames());
    }

    public function test_move_reports_the_list(): void
    {
        $changes = TaskChangeSet::between($this->task(), $this->task(['taskListId' => 'errands']));

        $this->assertTrue($changes->moved());
        $this->assertSame(['from' => 'groceries', 'to' => 'errands'], $changes->scalars['taskListId']);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function task(array $overrides = []): array
    {
        return [
            'id' => 'task-1',
            'uid' => 'uid-1',
            'taskListId' => 'groceries',
            'title' => 'Buy milk',
            'description' => null,
            'workflowStatus' => 'needs-action',
            'priority' => null,
            'start' => null,
            'due' => '2026-11-19T09:00:00',
            'showWithoutTime' => false,
            'categories' => [],
            ...$overrides,
        ];
    }
}
