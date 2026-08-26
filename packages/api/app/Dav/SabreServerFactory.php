<?php

declare(strict_types=1);

namespace App\Dav;

use App\Dav\Auth\SabrePdoBasicAndCookieAuth;
use App\Dav\Server\AppAddressBookRoot;
use App\Dav\Server\AppCalDAVPrincipalCollection;
use App\Dav\Server\AppCalendarRoot;
use App\Dav\Server\AppFilesRootCollection;
use App\Dav\Server\AppUserFilesHomeCollection;
use App\Dav\Server\CalendarMeetLinkPlugin;
use App\Dav\Server\FileNodeIndexPlugin;
use App\Dav\Server\GroupFilesPrincipalCollection;
use App\Dav\Server\PropIdEnsuringPlugin;
use App\Dav\Server\SearchIndexPlugin;
use App\Dav\Server\WebdavWriteGuardPlugin;
use App\Services\Calendars\CalendarMeetLinkWriteHook;
use App\Services\Contacts\MemberUriSanitizer;
use App\Services\Contacts\PropIdEnsurer;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Search\SearchIndexerService;
use App\Support\WgwInstallConfig;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Psr\Log\NullLogger;
use Sabre\CalDAV;
use Sabre\CardDAV;
use Sabre\DAV;
use Sabre\DAV\Locks;
use Sabre\DAVACL;

final class SabreServerFactory
{
    public function __construct(
        private WgwInstallConfig $install,
        private SearchIndexerService $searchIndexer,
        private FileNodeIndexService $fileNodeIndex,
        private CalendarMeetLinkWriteHook $meetLinkHook,
    ) {}

    public function create(): DAV\Server
    {
        $cfg = WgwSettings::normalized();
        $tz = (string) ($cfg[WgwSettings::TIMEZONE] ?? 'UTC');
        date_default_timezone_set($tz);

        $pdo = DB::connection('wgw')->getPdo();

        $cal = (bool) ($cfg[WgwSettings::CALENDAR_ENABLED] ?? true);
        $card = (bool) ($cfg[WgwSettings::CONTACTS_ENABLED] ?? true);
        $files = (bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true);

        $authBackend = new SabrePdoBasicAndCookieAuth($pdo, [
            'digestColumn' => 'digest',
        ]);
        $authBackend->setRealm((string) ($cfg[WgwSettings::AUTH_REALM] ?? 'SabreDAV'));

        $authPlugin = new DAV\Auth\Plugin($authBackend);

        $principalBackend = new DAVACL\PrincipalBackend\PDO($pdo);

        $nodes = [];
        if ($cal || $card) {
            $nodes[] = new AppCalDAVPrincipalCollection($principalBackend, $authPlugin);
        }
        if ($cal) {
            $caldavBackend = new CalDAV\Backend\PDO($pdo);
            $nodes[] = new AppCalendarRoot($principalBackend, $caldavBackend, $authPlugin);
        }
        if ($card) {
            $carddavBackend = new CardDAV\Backend\PDO($pdo);
            $nodes[] = new AppAddressBookRoot($principalBackend, $carddavBackend, $authPlugin);
        }
        if ($files) {
            $nodes[] = new AppFilesRootCollection([
                new AppUserFilesHomeCollection($principalBackend, 'users', $authPlugin),
                new GroupFilesPrincipalCollection($principalBackend, 'groups', $authPlugin),
            ]);
        }

        if ($nodes === []) {
            throw new \RuntimeException(
                'Invalid configuration: enable at least one of calendar, contacts, or files in app settings.'
            );
        }

        $server = new DAV\Server($nodes);
        $server->setBaseUri((string) ($cfg[WgwSettings::BASE_URI] ?? '/'));
        $server->setLogger(new NullLogger);

        $server->addPlugin($authPlugin);
        $server->addPlugin(new WebdavWriteGuardPlugin);
        $server->addPlugin(new SearchIndexPlugin($this->searchIndexer));
        $server->addPlugin(new FileNodeIndexPlugin($this->fileNodeIndex));
        $locksPath = rtrim($this->install->dataDir(), '/').'/webdav-locks.dat';
        $server->addPlugin(new Locks\Plugin(new Locks\Backend\File($locksPath)));
        if ((bool) ($cfg[WgwSettings::BROWSER_PLUGIN] ?? true)) {
            $server->addPlugin(new DAV\Browser\Plugin);
        }
        $server->addPlugin(new DAV\Sync\Plugin);

        if ($cal || $card) {
            $server->addPlugin(new DAV\Sharing\Plugin);
        }
        if ($cal || $card || $files) {
            $server->addPlugin(new DAVACL\Plugin);
        }

        if ($cal) {
            $server->addPlugin(new CalDAV\Plugin);
            $server->addPlugin(new CalDAV\Schedule\Plugin);
            $server->addPlugin(new CalDAV\SharingPlugin);
            $server->addPlugin(new CalDAV\ICSExportPlugin);
            $server->addPlugin(new CalendarMeetLinkPlugin($this->meetLinkHook));
        }

        if ($card) {
            $server->addPlugin(new CardDAV\Plugin);
            $server->addPlugin(new CardDAV\VCFExportPlugin);
            $server->addPlugin(new PropIdEnsuringPlugin(
                new PropIdEnsurer,
                new MemberUriSanitizer,
                PropIdEnsuringPlugin::cardBackendFromConnection(),
            ));
        }

        return $server;
    }
}
