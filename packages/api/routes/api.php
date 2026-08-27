<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\Admin\GroupMemberController as AdminGroupMemberController;
use App\Http\Controllers\Api\V1\Admin\GroupsController as AdminGroupsController;
use App\Http\Controllers\Api\V1\Admin\MailDeliveryTestController as AdminMailDeliveryTestController;
use App\Http\Controllers\Api\V1\Admin\PluginInstallController as AdminPluginInstallController;
use App\Http\Controllers\Api\V1\Admin\SearchJobController as AdminSearchJobController;
use App\Http\Controllers\Api\V1\Admin\SettingsController as AdminSettingsController;
use App\Http\Controllers\Api\V1\Admin\StateController as AdminStateController;
use App\Http\Controllers\Api\V1\Admin\UpdateBackupController as AdminUpdateBackupController;
use App\Http\Controllers\Api\V1\Admin\UpdateJobController as AdminUpdateJobController;
use App\Http\Controllers\Api\V1\Admin\UpdateLogController as AdminUpdateLogController;
use App\Http\Controllers\Api\V1\Admin\UpdateStateController as AdminUpdateStateController;
use App\Http\Controllers\Api\V1\Admin\UsersController as AdminUsersController;
use App\Http\Controllers\Api\V1\Auth\ConsumePasswordResetController;
use App\Http\Controllers\Api\V1\Auth\JwksController;
use App\Http\Controllers\Api\V1\Auth\MeController;
use App\Http\Controllers\Api\V1\Auth\RefreshController;
use App\Http\Controllers\Api\V1\Auth\RequestPasswordResetController;
use App\Http\Controllers\Api\V1\Auth\RevokeController;
use App\Http\Controllers\Api\V1\Auth\TokenController;
use App\Http\Controllers\Api\V1\Calendars\CalendarEventImportController;
use App\Http\Controllers\Api\V1\Calendars\CalendarFeedsController;
use App\Http\Controllers\Api\V1\Calendars\CalendarRsvpController;
use App\Http\Controllers\Api\V1\Calendars\CalendarSchedulingNotificationsController;
use App\Http\Controllers\Api\V1\Calendars\CalendarSubscriptionsController;
use App\Http\Controllers\Api\V1\Contacts\ContactCardImportController;
use App\Http\Controllers\Api\V1\Dav\CapabilitiesController as DavCapabilitiesController;
use App\Http\Controllers\Api\V1\Files\DriveSharesController;
use App\Http\Controllers\Api\V1\Files\DriveShareSessionsController;
use App\Http\Controllers\Api\V1\Files\FilesController;
use App\Http\Controllers\Api\V1\Home\StateController as HomeStateController;
use App\Http\Controllers\Api\V1\Installer\ActionController as InstallerActionController;
use App\Http\Controllers\Api\V1\Installer\BootstrapController as InstallerBootstrapController;
use App\Http\Controllers\Api\V1\Installer\StateController as InstallerStateController;
use App\Http\Controllers\Api\V1\Jmap\JmapApiController;
use App\Http\Controllers\Api\V1\Jmap\JmapBlobController;
use App\Http\Controllers\Api\V1\Jmap\JmapSessionController;
use App\Http\Controllers\Api\V1\Jmap\JmapStubController;
use App\Http\Controllers\Api\V1\Mail\MailController;
use App\Http\Controllers\Api\V1\Meetings\MeetingsController;
use App\Http\Controllers\Api\V1\Plugins\ActivationController as PluginsActivationController;
use App\Http\Controllers\Api\V1\Plugins\IndexController as PluginsIndexController;
use App\Http\Controllers\Api\V1\Plugins\SessionController as PluginsSessionController;
use App\Http\Controllers\Api\V1\Rooms\RoomSessionController;
use App\Http\Controllers\Api\V1\Search\UnifiedSearchController;
use App\Http\Controllers\Api\V1\Search\UnifiedSearchDownloadController;
use App\Http\Controllers\Api\V1\Settings\MailController as SettingsMailController;
use App\Http\Controllers\Api\V1\Settings\ProfileController as SettingsProfileController;
use App\Http\Controllers\Api\V1\Settings\StateController as SettingsStateController;
use App\Http\Controllers\Api\V1\System\CapabilitiesController;
use App\Http\Controllers\Api\V1\System\HealthController;
use App\Http\Controllers\Api\V1\Tasks\CapabilitiesController as TasksCapabilitiesController;
use App\Http\Controllers\Api\V1\Tasks\TaskCalendarsController;
use App\Http\Controllers\Api\V1\Tasks\TasksController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Greenfield REST API (OpenAPI: packages/api/openapi/openapi.json)
|--------------------------------------------------------------------------
*/

Route::get('health', HealthController::class);
Route::get('capabilities', CapabilitiesController::class);

Route::get('.well-known/jwks.json', JwksController::class);

Route::post('auth/token', TokenController::class);
Route::post('auth/refresh', RefreshController::class);
Route::post('auth/revoke', RevokeController::class);
Route::post('auth/password-resets', RequestPasswordResetController::class);
Route::post('auth/password-resets/{token}', ConsumePasswordResetController::class)
    ->where('token', '[A-Fa-f0-9]+');

Route::get('calendar/rsvp/{token}', [CalendarRsvpController::class, 'show'])
    ->where('token', '[A-Za-z0-9]+');
Route::post('calendar/rsvp/{token}', [CalendarRsvpController::class, 'respond'])
    ->where('token', '[A-Za-z0-9]+');
Route::get('calendars/feeds/{token}', [CalendarFeedsController::class, 'publicShow'])
    ->where('token', '[A-Za-z0-9]+(?:\\.ics)?');

Route::post('meetings/rooms', [MeetingsController::class, 'store'])
    ->middleware('wgw.auth');
Route::get('meetings/rooms/{roomId}', [MeetingsController::class, 'show'])
    ->where('roomId', '[A-Za-z0-9_-]+');
Route::patch('meetings/rooms/{roomId}', [MeetingsController::class, 'update'])
    ->middleware('wgw.auth')
    ->where('roomId', '[A-Za-z0-9_-]+');

Route::post('rooms/{roomId}/participants', [RoomSessionController::class, 'storeParticipant'])
    ->where('roomId', '[A-Za-z0-9_.-]+');
Route::get('rooms/{roomId}/events', [RoomSessionController::class, 'indexEvents'])
    ->where('roomId', '[A-Za-z0-9_.-]+');
Route::post('rooms/{roomId}/events', [RoomSessionController::class, 'storeEvent'])
    ->where('roomId', '[A-Za-z0-9_.-]+');
Route::delete('rooms/{roomId}/participants/{participantId}', [RoomSessionController::class, 'destroyParticipant'])
    ->where('roomId', '[A-Za-z0-9_.-]+')
    ->where('participantId', '[A-Za-z0-9_-]+|me');
Route::get('rooms/{roomId}/configuration', [RoomSessionController::class, 'configuration'])
    ->where('roomId', '[A-Za-z0-9_.-]+');
Route::post('rooms/{roomId}/messages', [RoomSessionController::class, 'storeMessage'])
    ->where('roomId', '[A-Za-z0-9_.-]+');

Route::middleware([
    EncryptCookies::class,
    AddQueuedCookiesToResponse::class,
    StartSession::class,
])->group(function (): void {
    Route::get('installer/state', InstallerStateController::class);
    Route::get('installer/bootstrap', InstallerBootstrapController::class);
    Route::post('installer/action', InstallerActionController::class);
});

$filesSession = [
    EncryptCookies::class,
    AddQueuedCookiesToResponse::class,
    StartSession::class,
];

Route::middleware(['wgw.auth', 'wgw.role:user'])->group(function () use ($filesSession): void {
    Route::get('me', MeController::class);
    Route::get('workspace/state', HomeStateController::class);
    Route::get('dav/capabilities', DavCapabilitiesController::class);

    // Drive cwd uses Laravel session (DriveSessionStore). Share CRUD does not — keep it
    // off StartSession so SESSION_DRIVER=database without a sessions table cannot 500 the dialog.
    Route::get('files/shares', [DriveSharesController::class, 'index']);
    Route::post('files/shares', [DriveSharesController::class, 'store']);
    Route::get('files/shares/at-path', [DriveSharesController::class, 'atPath']);
    Route::get('files/shares/principals', [DriveSharesController::class, 'principals']);
    Route::post('files/shares/public/revoke-all', [DriveSharesController::class, 'revokeAllPublic']);
    Route::get('files/shares/by-principal', [DriveSharesController::class, 'byPrincipal']);
    Route::get('files/shares/{shareId}', [DriveSharesController::class, 'show'])
        ->where('shareId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    Route::patch('files/shares/{shareId}', [DriveSharesController::class, 'update'])
        ->where('shareId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    Route::delete('files/shares/{shareId}', [DriveSharesController::class, 'destroy'])
        ->where('shareId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    Route::post('files/shares/{shareId}/invites', [DriveSharesController::class, 'storeInvite'])
        ->where('shareId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    Route::delete('files/shares/{shareId}/invites/{inviteId}', [DriveSharesController::class, 'destroyInvite'])
        ->where('shareId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
        ->where('inviteId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    Route::get('files/shared-with-me', [DriveSharesController::class, 'sharedWithMe']);
    Route::post('files/share-sessions/accept', [DriveShareSessionsController::class, 'accept']);

    Route::middleware($filesSession)->group(function (): void {
        Route::get('files/context', [FilesController::class, 'context']);
        Route::get('files', [FilesController::class, 'index']);
        Route::post('files/star', [FilesController::class, 'star']);
        Route::delete('files/star', [FilesController::class, 'unstar']);
        Route::get('files/starred', [FilesController::class, 'starred']);
        Route::post('files/rooms', [FilesController::class, 'resolveRoom']);
    });

    Route::get('search/results', UnifiedSearchController::class);
    Route::get('search/results/{resultId}/content', [UnifiedSearchDownloadController::class, 'contentByResultId'])
        ->where('resultId', '.+');

    Route::get('plugins', PluginsIndexController::class);
    Route::post('plugins/{id}/session', PluginsSessionController::class)
        ->where('id', '[a-z0-9_-]+');
    Route::put('plugins/{id}/activation', PluginsActivationController::class)
        ->where('id', '[a-z0-9_-]+');
    Route::get('settings/state', SettingsStateController::class);
    Route::put('settings/profile', SettingsProfileController::class);
    Route::put('settings/mail', SettingsMailController::class);

    Route::get('mail/status', [MailController::class, 'status']);
    Route::get('mail/folders', [MailController::class, 'foldersIndex']);
    Route::post('mail/folders', [MailController::class, 'foldersStore']);
    Route::patch('mail/folders', [MailController::class, 'foldersUpdate']);
    Route::delete('mail/folders', [MailController::class, 'foldersDestroy']);
    Route::get('mail/messages', [MailController::class, 'messagesIndex']);
    Route::post('mail/messages', [MailController::class, 'messagesStore']);
    Route::post('mail/drafts', [MailController::class, 'draftsStore']);
    Route::post('mail/move', [MailController::class, 'move']);
    Route::get('mail/messages/{messageId}/attachments/{attachmentId}', [MailController::class, 'messageAttachmentById'])
        ->where('messageId', '[^/]+')
        ->where('attachmentId', '[0-9.]+');
    Route::get('mail/messages/{messageId}/attachments', [MailController::class, 'messageAttachmentsById'])
        ->where('messageId', '[^/]+');
    Route::get('mail/messages/{messageId}', [MailController::class, 'messageShowById'])
        ->where('messageId', '[^/]+');
    Route::patch('mail/messages/{messageId}', [MailController::class, 'messageUpdateById'])
        ->where('messageId', '[^/]+');
    Route::delete('mail/messages/{messageId}', [MailController::class, 'messageDestroyById'])
        ->where('messageId', '[^/]+');

    Route::middleware('wgw.calendars')->group(function (): void {
        Route::post('calendars/events/import', CalendarEventImportController::class);
        Route::get('calendars/scheduling/invitees', [CalendarSchedulingNotificationsController::class, 'invitees']);
        Route::get('calendars/scheduling/notifications', [CalendarSchedulingNotificationsController::class, 'index']);
        Route::post('calendars/scheduling/notifications/{notificationId}/respond', [CalendarSchedulingNotificationsController::class, 'respond'])
            ->where('notificationId', '[^/]+');
        Route::delete('calendars/scheduling/notifications/{notificationId}', [CalendarSchedulingNotificationsController::class, 'destroy'])
            ->where('notificationId', '[^/]+');

        Route::get('calendars/subscriptions', [CalendarSubscriptionsController::class, 'index']);
        Route::post('calendars/subscriptions', [CalendarSubscriptionsController::class, 'store']);
        Route::get('calendars/subscriptions/{id}', [CalendarSubscriptionsController::class, 'show'])
            ->where('id', '[A-Za-z0-9-]+');
        Route::delete('calendars/subscriptions/{id}', [CalendarSubscriptionsController::class, 'destroy'])
            ->where('id', '[A-Za-z0-9-]+');
        Route::post('calendars/subscriptions/{id}/refresh', [CalendarSubscriptionsController::class, 'refresh'])
            ->where('id', '[A-Za-z0-9-]+');
        Route::get('calendars/{calendarId}/feed', [CalendarFeedsController::class, 'show'])
            ->where('calendarId', '[A-Za-z0-9_-]+');
        Route::post('calendars/{calendarId}/feed', [CalendarFeedsController::class, 'store'])
            ->where('calendarId', '[A-Za-z0-9_-]+');
        Route::delete('calendars/{calendarId}/feed', [CalendarFeedsController::class, 'destroy'])
            ->where('calendarId', '[A-Za-z0-9_-]+');
    });

    Route::middleware('wgw.tasks')->group(function (): void {
        Route::get('tasks/capabilities', TasksCapabilitiesController::class);
        Route::get('tasks/tasklists/changes', [TaskCalendarsController::class, 'changes']);
        Route::get('tasks/tasklists', [TaskCalendarsController::class, 'index']);
        Route::post('tasks/tasklists', [TaskCalendarsController::class, 'store']);
        Route::get('tasks/tasklists/{taskListId}', [TaskCalendarsController::class, 'show'])
            ->where('taskListId', '[a-z0-9_-]+');
        Route::patch('tasks/tasklists/{taskListId}', [TaskCalendarsController::class, 'update'])
            ->where('taskListId', '[a-z0-9_-]+');
        Route::delete('tasks/tasklists/{taskListId}', [TaskCalendarsController::class, 'destroy'])
            ->where('taskListId', '[a-z0-9_-]+');
        Route::post('tasks/items/query', [TasksController::class, 'query']);
        Route::get('tasks/items', [TasksController::class, 'index']);
        Route::post('tasks/items', [TasksController::class, 'store']);
        Route::get('tasks/items/{taskId}', [TasksController::class, 'show'])
            ->where('taskId', '[A-Za-z0-9_.#-]+');
        Route::put('tasks/items/{taskId}', [TasksController::class, 'update'])
            ->where('taskId', '[A-Za-z0-9_.#-]+');
        Route::patch('tasks/items/{taskId}', [TasksController::class, 'patch'])
            ->where('taskId', '[A-Za-z0-9_.#-]+');
        Route::delete('tasks/items/{taskId}', [TasksController::class, 'destroy'])
            ->where('taskId', '[A-Za-z0-9_.#-]+');
    });

    Route::middleware('wgw.contacts')->group(function (): void {
        Route::post('contacts/cards/import', ContactCardImportController::class);
    });

    // JMAP transport envelope (RFC 8620) — deliberately outside any domain
    // feature-gate middleware: domain availability is expressed through the
    // advertised capabilities and the `using` guard (JmapCapabilitySet), so
    // disabling one domain never takes the whole envelope down.
    Route::get('jmap/session', JmapSessionController::class);
    Route::post('jmap', [JmapApiController::class, 'handle']);
    Route::get('jmap/download/{accountId}/{blobId}/{name}', [JmapBlobController::class, 'download']);
    Route::post('jmap/upload/{accountId}', [JmapBlobController::class, 'upload']);
    Route::get('jmap/events/{types}/{closeafter}/{ping}', [JmapStubController::class, 'eventSource']);
});

Route::middleware(['wgw.auth'])->group(function () use ($filesSession): void {
    Route::middleware($filesSession)->group(function (): void {
        Route::get('files/children', [FilesController::class, 'children']);
        Route::match(['GET', 'HEAD'], 'files/content', [FilesController::class, 'content']);
        Route::get('files/collaboration', [FilesController::class, 'showCollaboration']);
        Route::put('files/collaboration', [FilesController::class, 'updateCollaboration']);
    });
});

Route::post('files/share-sessions', [DriveShareSessionsController::class, 'store']);

Route::middleware(['wgw.auth', 'wgw.role:admin'])->prefix('admin')->group(function (): void {
    Route::get('state', AdminStateController::class);
    Route::post('users', [AdminUsersController::class, 'store']);
    Route::patch('users/{username}', [AdminUsersController::class, 'update'])
        ->where('username', '[a-z0-9_-]+');
    Route::delete('users/{username}', [AdminUsersController::class, 'destroy'])
        ->where('username', '[a-z0-9_-]+');
    Route::post('groups', [AdminGroupsController::class, 'store']);
    Route::patch('groups/{group}', [AdminGroupsController::class, 'update'])
        ->where('group', '[a-z0-9_-]+');
    Route::delete('groups/{group}', [AdminGroupsController::class, 'destroy'])
        ->where('group', '[a-z0-9_-]+');
    Route::put('settings', AdminSettingsController::class);
    Route::post('mail-delivery/test', AdminMailDeliveryTestController::class);
    Route::get('updates/state', AdminUpdateStateController::class);
    Route::get('updates/log', [AdminUpdateLogController::class, 'show']);
    Route::delete('updates/log', [AdminUpdateLogController::class, 'destroy']);
    Route::post('update-jobs', [AdminUpdateJobController::class, 'store']);
    Route::delete('update-jobs/{jobId}', [AdminUpdateJobController::class, 'destroy'])
        ->where('jobId', '[a-z0-9_-]+');
    Route::post('search/jobs', [AdminSearchJobController::class, 'store']);
    Route::get('search/jobs/current', [AdminSearchJobController::class, 'showCurrent']);
    Route::delete('search/jobs/{jobId}', [AdminSearchJobController::class, 'destroy'])
        ->where('jobId', '[a-z0-9_-]+');
    Route::post('plugins', AdminPluginInstallController::class);
    Route::get('backups/{name}', [AdminUpdateBackupController::class, 'show']);
    Route::delete('backups/{name}', [AdminUpdateBackupController::class, 'destroy']);
    Route::put('groups/{group}/members/{username}', [AdminGroupMemberController::class, 'store']);
    Route::delete('groups/{group}/members/{username}', [AdminGroupMemberController::class, 'destroy']);
});
