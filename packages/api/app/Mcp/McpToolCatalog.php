<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Mcp\Tools\AddressBookListTool;
use App\Mcp\Tools\AddressBookShareTool;
use App\Mcp\Tools\AddressBookWriteTool;
use App\Mcp\Tools\CalendarEventsTool;
use App\Mcp\Tools\CalendarEventWriteTool;
use App\Mcp\Tools\CalendarListTool;
use App\Mcp\Tools\CalendarShareTool;
use App\Mcp\Tools\CalendarWriteTool;
use App\Mcp\Tools\CapabilitiesTool;
use App\Mcp\Tools\ContactQueryTool;
use App\Mcp\Tools\ContactsSearchTool;
use App\Mcp\Tools\ContactWriteTool;
use App\Mcp\Tools\DocsReadTool;
use App\Mcp\Tools\DocsSearchTool;
use App\Mcp\Tools\DocsShareTool;
use App\Mcp\Tools\DocsWriteTool;
use App\Mcp\Tools\DriveListTool;
use App\Mcp\Tools\DriveReadTool;
use App\Mcp\Tools\DriveSearchTool;
use App\Mcp\Tools\DriveShareTool;
use App\Mcp\Tools\DriveWriteTool;
use App\Mcp\Tools\MailSendTool;
use App\Mcp\Tools\MailStatusTool;
use App\Mcp\Tools\MeetChannelListTool;
use App\Mcp\Tools\MeetChannelWriteTool;
use App\Mcp\Tools\MeetCreateScheduledTool;
use App\Mcp\Tools\MeetMessageListTool;
use App\Mcp\Tools\MeetMessageWriteTool;
use App\Mcp\Tools\NotebookListTool;
use App\Mcp\Tools\NotebookShareTool;
use App\Mcp\Tools\NotebookWriteTool;
use App\Mcp\Tools\NotesQueryTool;
use App\Mcp\Tools\NotesSearchTool;
use App\Mcp\Tools\NoteWriteTool;
use App\Mcp\Tools\TaskListShareTool;
use App\Mcp\Tools\TaskListWriteTool;
use App\Mcp\Tools\TasksListTool;
use App\Mcp\Tools\TaskWriteTool;
use App\Mcp\Tools\WhoamiTool;
use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;
use App\Support\WgwSettings;

final class McpToolCatalog
{
    /**
     * @return list<class-string>
     */
    public function enabledTools(): array
    {
        $cfg = WgwSettings::normalized();
        $tools = [WhoamiTool::class, CapabilitiesTool::class];
        if ((bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true)) {
            $tools[] = DriveSearchTool::class;
            $tools[] = DriveListTool::class;
            $tools[] = DriveReadTool::class;
            $tools[] = DriveWriteTool::class;
            $tools[] = DriveShareTool::class;
            $tools[] = DocsSearchTool::class;
            $tools[] = DocsReadTool::class;
            $tools[] = DocsWriteTool::class;
            $tools[] = DocsShareTool::class;
        }
        if ((bool) ($cfg[WgwSettings::CALENDAR_ENABLED] ?? true)) {
            $tools[] = CalendarListTool::class;
            $tools[] = CalendarWriteTool::class;
            $tools[] = CalendarShareTool::class;
            $tools[] = CalendarEventsTool::class;
            $tools[] = CalendarEventWriteTool::class;
        }
        if ((bool) ($cfg[WgwSettings::TASKS_ENABLED] ?? true)) {
            $tools[] = TasksListTool::class;
            $tools[] = TaskListWriteTool::class;
            $tools[] = TaskListShareTool::class;
            $tools[] = TaskWriteTool::class;
        }
        if ((bool) ($cfg[WgwSettings::CONTACTS_ENABLED] ?? true)) {
            $tools[] = ContactsSearchTool::class;
            $tools[] = AddressBookListTool::class;
            $tools[] = AddressBookWriteTool::class;
            $tools[] = AddressBookShareTool::class;
            $tools[] = ContactQueryTool::class;
            $tools[] = ContactWriteTool::class;
        }
        if ((bool) ($cfg[WgwSettings::NOTES_ENABLED] ?? true)) {
            $tools[] = NotesSearchTool::class;
            $tools[] = NotebookListTool::class;
            $tools[] = NotebookWriteTool::class;
            $tools[] = NotebookShareTool::class;
            $tools[] = NotesQueryTool::class;
            $tools[] = NoteWriteTool::class;
        }
        $mailOn = (bool) (AppSetting::getValue(SettingKeys::MAIL_ENABLED, true));
        if ($mailOn) {
            $tools[] = MailStatusTool::class;
            $tools[] = MailSendTool::class;
        }

        $tools[] = MeetChannelListTool::class;
        $tools[] = MeetChannelWriteTool::class;
        $tools[] = MeetMessageListTool::class;
        $tools[] = MeetMessageWriteTool::class;
        $tools[] = MeetCreateScheduledTool::class;

        return $tools;
    }
}
