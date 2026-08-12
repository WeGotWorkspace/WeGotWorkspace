<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\Admin\GroupMemberController as AdminGroupMemberController;
use App\Http\Controllers\Api\V1\Admin\GroupsController as AdminGroupsController;
use App\Http\Controllers\Api\V1\Admin\PluginInstallController as AdminPluginInstallController;
use App\Http\Controllers\Api\V1\Admin\SearchJobController as AdminSearchJobController;
use App\Http\Controllers\Api\V1\Admin\SettingsController as AdminSettingsController;
use App\Http\Controllers\Api\V1\Admin\StateController as AdminStateController;
use App\Http\Controllers\Api\V1\Admin\UpdateBackupController as AdminUpdateBackupController;
use App\Http\Controllers\Api\V1\Admin\UpdateJobController as AdminUpdateJobController;
use App\Http\Controllers\Api\V1\Admin\UpdateLogController as AdminUpdateLogController;
use App\Http\Controllers\Api\V1\Admin\UpdateStateController as AdminUpdateStateController;
use App\Http\Controllers\Api\V1\Admin\UsersController as AdminUsersController;
use App\Http\Controllers\Api\V1\Auth\JwksController;
use App\Http\Controllers\Api\V1\Auth\MeController;
use App\Http\Controllers\Api\V1\Auth\RefreshController;
use App\Http\Controllers\Api\V1\Auth\RevokeController;
use App\Http\Controllers\Api\V1\Auth\TokenController;
use App\Http\Controllers\Api\V1\Calendars\CalendarEventsController;
use App\Http\Controllers\Api\V1\Calendars\CalendarsController;
use App\Http\Controllers\Api\V1\Contacts\AddressBooksController as ContactsAddressBooksController;
use App\Http\Controllers\Api\V1\Contacts\ContactBlobsController;
use App\Http\Controllers\Api\V1\Contacts\ContactCardImportController;
use App\Http\Controllers\Api\V1\Contacts\ContactCardsController;
use App\Http\Controllers\Api\V1\Contacts\ContactCardVcfController;
use App\Http\Controllers\Api\V1\Dav\CapabilitiesController as DavCapabilitiesController;
use App\Http\Controllers\Api\V1\Files\DriveSharesController;
use App\Http\Controllers\Api\V1\Files\DriveShareSessionsController;
use App\Http\Controllers\Api\V1\Files\FilesController;
use App\Http\Controllers\Api\V1\Home\StateController as HomeStateController;
use App\Http\Controllers\Api\V1\Installer\ActionController as InstallerActionController;
use App\Http\Controllers\Api\V1\Installer\BootstrapController as InstallerBootstrapController;
use App\Http\Controllers\Api\V1\Installer\StateController as InstallerStateController;
use App\Http\Controllers\Api\V1\Mail\MailController;
use App\Http\Controllers\Api\V1\Meetings\MeetingsController;
use App\Http\Controllers\Api\V1\Notes\CapabilitiesController as NotesCapabilitiesController;
use App\Http\Controllers\Api\V1\Notes\ItemsController as NotesItemsController;
use App\Http\Controllers\Api\V1\Notes\NotebooksController;
use App\Http\Controllers\Api\V1\Notes\SharedController as NotesSharedController;
use App\Http\Controllers\Api\V1\Notes\StateController as NotesStateController;
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

Route::post('meetings/rooms', [MeetingsController::class, 'store']);
Route::get('meetings/rooms/{roomId}', [MeetingsController::class, 'show'])
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

    Route::get('notes/capabilities', NotesCapabilitiesController::class);
    Route::get('notes/state', NotesStateController::class);
    Route::get('notes/items', [NotesItemsController::class, 'index']);
    Route::post('notes/items', [NotesItemsController::class, 'store']);
    Route::put('notes/items/{id}', [NotesItemsController::class, 'update']);
    Route::patch('notes/items/{id}', [NotesItemsController::class, 'patch']);
    Route::delete('notes/items/{id}', [NotesItemsController::class, 'destroy']);
    Route::get('notes/notebooks', [NotebooksController::class, 'index']);
    Route::post('notes/notebooks', [NotebooksController::class, 'store']);
    Route::patch('notes/notebooks/{name}', [NotebooksController::class, 'update']);
    Route::delete('notes/notebooks/{name}', [NotebooksController::class, 'destroy']);
    Route::get('notes/shared-with-me', [NotesSharedController::class, 'sharedWithMe']);
    Route::get('notes/shared-notebooks', [NotesSharedController::class, 'sharedNotebooks']);

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
            ->where('taskId', '[a-z0-9_.#-]+');
        Route::put('tasks/items/{taskId}', [TasksController::class, 'update'])
            ->where('taskId', '[a-z0-9_.#-]+');
        Route::patch('tasks/items/{taskId}', [TasksController::class, 'patch'])
            ->where('taskId', '[a-z0-9_.#-]+');
        Route::delete('tasks/items/{taskId}', [TasksController::class, 'destroy'])
            ->where('taskId', '[a-z0-9_.#-]+');
    });

    Route::middleware('wgw.contacts')->group(function (): void {
        Route::get('contacts/addressbooks/changes', [ContactsAddressBooksController::class, 'changes']);
        Route::get('contacts/addressbooks', [ContactsAddressBooksController::class, 'index']);
        Route::post('contacts/addressbooks', [ContactsAddressBooksController::class, 'store']);
        Route::get('contacts/addressbooks/{addressBookId}', [ContactsAddressBooksController::class, 'show'])
            ->where('addressBookId', '[a-z0-9_-]+');
        Route::patch('contacts/addressbooks/{addressBookId}', [ContactsAddressBooksController::class, 'update'])
            ->where('addressBookId', '[a-z0-9_-]+');
        Route::delete('contacts/addressbooks/{addressBookId}', [ContactsAddressBooksController::class, 'destroy'])
            ->where('addressBookId', '[a-z0-9_-]+');
        Route::post('contacts/cards/set', [ContactCardsController::class, 'set']);
        Route::get('contacts/cards/changes', [ContactCardsController::class, 'changes']);
        Route::post('contacts/cards/query', [ContactCardsController::class, 'query']);
        Route::post('contacts/cards/import', ContactCardImportController::class);
        Route::get('contacts/cards', [ContactCardsController::class, 'index']);
        Route::post('contacts/cards', [ContactCardsController::class, 'store']);
        Route::get('contacts/cards/{cardId}/vcf', ContactCardVcfController::class)
            ->where('cardId', '[a-z0-9_-]+');
        Route::get('contacts/cards/{cardId}', [ContactCardsController::class, 'show'])
            ->where('cardId', '[a-z0-9_-]+');
        Route::put('contacts/cards/{cardId}', [ContactCardsController::class, 'update'])
            ->where('cardId', '[a-z0-9_-]+');
        Route::patch('contacts/cards/{cardId}', [ContactCardsController::class, 'patch'])
            ->where('cardId', '[a-z0-9_-]+');
        Route::delete('contacts/cards/{cardId}', [ContactCardsController::class, 'destroy'])
            ->where('cardId', '[a-z0-9_-]+');
        Route::post('contacts/blobs', [ContactBlobsController::class, 'store']);
        Route::get('contacts/blobs/{blobId}', [ContactBlobsController::class, 'show'])
            ->where('blobId', '[0-9a-f-]+');
    });

    Route::middleware('wgw.calendars')->group(function (): void {
        Route::get('calendars/calendars/changes', [CalendarsController::class, 'changes']);
        Route::get('calendars/calendars', [CalendarsController::class, 'index']);
        Route::post('calendars/calendars', [CalendarsController::class, 'store']);
        Route::get('calendars/calendars/{calendarId}', [CalendarsController::class, 'show'])
            ->where('calendarId', '[a-z0-9_-]+');
        Route::patch('calendars/calendars/{calendarId}', [CalendarsController::class, 'update'])
            ->where('calendarId', '[a-z0-9_-]+');
        Route::delete('calendars/calendars/{calendarId}', [CalendarsController::class, 'destroy'])
            ->where('calendarId', '[a-z0-9_-]+');
        Route::get('calendars/events/changes', [CalendarEventsController::class, 'changes']);
        Route::get('calendars/events', [CalendarEventsController::class, 'index']);
        Route::post('calendars/events', [CalendarEventsController::class, 'store']);
        Route::get('calendars/events/{eventId}', [CalendarEventsController::class, 'show'])
            ->where('eventId', '[a-z0-9_#%-]+');
        Route::put('calendars/events/{eventId}', [CalendarEventsController::class, 'update'])
            ->where('eventId', '[a-z0-9_#%-]+');
        Route::patch('calendars/events/{eventId}', [CalendarEventsController::class, 'patch'])
            ->where('eventId', '[a-z0-9_#%-]+');
        Route::delete('calendars/events/{eventId}', [CalendarEventsController::class, 'destroy'])
            ->where('eventId', '[a-z0-9_#%-]+');
    });
});

Route::middleware(['wgw.auth'])->group(function () use ($filesSession): void {
    Route::middleware($filesSession)->group(function (): void {
        Route::get('files/children', [FilesController::class, 'children']);
        Route::post('files/directories', [FilesController::class, 'storeDirectory']);
        Route::patch('files', [FilesController::class, 'patch']);
        Route::delete('files', [FilesController::class, 'destroy']);
        Route::match(['GET', 'HEAD', 'POST'], 'files/content', [FilesController::class, 'content']);
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
