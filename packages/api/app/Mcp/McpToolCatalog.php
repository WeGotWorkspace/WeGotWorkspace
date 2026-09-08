<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Mcp\Tools\CalendarListTool;
use App\Mcp\Tools\CapabilitiesTool;
use App\Mcp\Tools\ContactsSearchTool;
use App\Mcp\Tools\DriveListTool;
use App\Mcp\Tools\DriveReadTool;
use App\Mcp\Tools\DriveSearchTool;
use App\Mcp\Tools\MailSendTool;
use App\Mcp\Tools\MailStatusTool;
use App\Mcp\Tools\NotesSearchTool;
use App\Mcp\Tools\TasksListTool;
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
        }
        if ((bool) ($cfg[WgwSettings::CALENDAR_ENABLED] ?? true)) {
            $tools[] = CalendarListTool::class;
        }
        if ((bool) ($cfg[WgwSettings::TASKS_ENABLED] ?? true)) {
            $tools[] = TasksListTool::class;
        }
        if ((bool) ($cfg[WgwSettings::CONTACTS_ENABLED] ?? true)) {
            $tools[] = ContactsSearchTool::class;
        }
        if ((bool) ($cfg[WgwSettings::NOTES_ENABLED] ?? true)) {
            $tools[] = NotesSearchTool::class;
        }
        $mailOn = (bool) (AppSetting::getValue(SettingKeys::MAIL_ENABLED, true));
        if ($mailOn) {
            $tools[] = MailStatusTool::class;
            $tools[] = MailSendTool::class;
        }

        return $tools;
    }
}
