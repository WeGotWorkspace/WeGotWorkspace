<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\DriveShareGrant;
use App\Models\JmapBlob;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\Methods\JmapMethodInterface;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\Support\OpenApiContract;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipRegistry;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Ownership matrix for capability-token access (plan chunk-p-public).
 *
 * Covers the public scopes (calendar feed, drive public links, email invites,
 * RSVP tokens), the guest actor on the `wgw.auth`-only drive routes, and the
 * guest actor on every user-role operation (variant `role-gate`). Guest tokens
 * always come from a real share-session exchange. Drive targets live in
 * carol's drive: a shared folder, a sibling whose name extends it, and an
 * unrelated folder.
 */
final class PublicAccessOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;
    use SendsFramedCollaboration;

    private const ROLE_GATE = 'role-gate';

    /**
     * Marker in the name and body of every file outside the shared folder.
     */
    private const OUTSIDE_MARK = 'qz7-outside-folder';

    /**
     * Marker in the name and body of the file beside the doc inside the
     * shared folder: outside a link to the doc alone.
     */
    private const BESIDE_MARK = 'qz7-beside-doc';

    private const ROOT = '/users/carol/proj';

    private const DOC = self::ROOT.'/doc.md';

    private const BRIEF = self::ROOT.'/brief-'.self::BESIDE_MARK.'.txt';

    private const SIBLING = '/users/carol/proj-secret';

    private const SIBLING_DOC = self::SIBLING.'/secret-'.self::OUTSIDE_MARK.'.md';

    private const OTHER = '/users/carol/other';

    private const OTHER_DOC = self::OTHER.'/other-'.self::OUTSIDE_MARK.'.md';

    private const DOC_BODY = "# Project doc\n";

    private const BRIEF_BODY = 'brief '.self::BESIDE_MARK;

    private const SIBLING_BODY = '# Sibling '.self::OUTSIDE_MARK."\n";

    private const OTHER_BODY = '# Other '.self::OUTSIDE_MARK."\n";

    private const LINK_PASSWORD = 'open-sesame';

    private const GUEST_JMAP = 'POST /jmap/guest';

    private const GUEST_UPLOAD = 'POST /jmap/guest/upload/{accountId}';

    /** @var list<string> */
    private const GUEST_USING = [
        JmapCapabilities::CORE,
        JmapCapabilities::FILENODE,
        JmapCapabilities::BLOB_ASSEMBLY,
        JmapCapabilities::FILENODE_VERSION_CHECK,
    ];

    /** Bytes a guest uploads in the guest upload rows. */
    private const GUEST_BYTES = 'guest upload bytes';

    /**
     * Routes behind the user role whose OpenAPI access annotation differs.
     */
    private const ROUTED_FOR_USERS = ['POST /files/rooms'];

    /** Guest path variants on files/children (directory) and files/content (file). */
    private const GUEST_PATHS = [
        'subtree' => [self::ROOT, self::DOC],
        'dotdot' => [self::ROOT.'/../proj-secret', self::ROOT.'/../proj-secret/secret-'.self::OUTSIDE_MARK.'.md'],
        'backslash' => [self::ROOT.'\\..\\proj-secret', self::ROOT.'\\..\\proj-secret\\secret-'.self::OUTSIDE_MARK.'.md'],
        'absolute' => [self::OTHER, self::OTHER_DOC],
        'sibling-prefix' => [self::SIBLING, self::SIBLING_DOC],
        'other-link' => [self::OTHER, self::OTHER_DOC],
    ];

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);

        $this->dataDir = storage_path('framework/testing/wgw-ownership-public-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/'.OwnershipPrincipals::CAROL);
        WgwTestDisks::refresh($this->dataDir);
        $disk = app(WgwStorage::class)->files();
        $disk->put(ltrim(self::DOC, '/'), self::DOC_BODY);
        $disk->put(ltrim(self::BRIEF, '/'), self::BRIEF_BODY);
        $disk->put(ltrim(self::SIBLING_DOC, '/'), self::SIBLING_BODY);
        $disk->put(ltrim(self::OTHER_DOC, '/'), self::OTHER_BODY);
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }
        parent::tearDown();
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        $anonymous = Actor::Anonymous;

        // Calendar feed tokens.
        foreach ([
            'valid' => Outcome::Allowed,
            'other-calendar' => Outcome::Allowed,
            'unknown' => Outcome::NotFound,
            'revoked' => Outcome::NotFound,
            'rotated' => Outcome::NotFound,
            'deleted-calendar' => Outcome::NotFound,
            'as-bearer' => Outcome::Unauthenticated,
        ] as $variant => $outcome) {
            $cases[] = OwnershipCase::of('GET /calendars/feeds/{token}', $anonymous, Scope::CalendarFeed, $outcome)->variant($variant);
        }

        // RSVP tokens.
        foreach (['own' => Outcome::Allowed, 'tampered' => Outcome::NotFound, 'superseded' => Outcome::NotFound] as $variant => $outcome) {
            $cases[] = OwnershipCase::of('GET /calendar/rsvp/{token}', $anonymous, Scope::Rsvp, $outcome)->variant($variant);
        }
        foreach (['own' => Outcome::Allowed, 'other-attendee' => Outcome::Allowed, 'tampered' => Outcome::NotFound] as $variant => $outcome) {
            $cases[] = OwnershipCase::of('POST /calendar/rsvp/{token}', $anonymous, Scope::Rsvp, $outcome)->variant($variant);
        }

        // Share-session exchange.
        $exchange = 'POST /files/share-sessions';
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkOpen, Outcome::Allowed)->variant('valid');
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkOpen, Outcome::NotFound)->withCode('share_unavailable')->variant('unknown-token');
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkPassword, Outcome::PasswordRequired)->variant('missing');
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkPassword, Outcome::PasswordInvalid)->variant('wrong');
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkPassword, Outcome::Allowed)->variant('right');
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkExpired, Outcome::Gone)->withCode('share_unavailable');
        // A revoked link answers like an expired one: the link existed and is no longer usable.
        $cases[] = OwnershipCase::of($exchange, $anonymous, Scope::LinkRevoked, Outcome::Gone)->withCode('share_unavailable');

        // Email invites, accepted by a signed-in user.
        $accept = 'POST /files/share-sessions/accept';
        foreach (Actor::signedIn() as $actor) {
            foreach ([
                'accept' => Outcome::Allowed,
                'other-invite' => Outcome::Allowed,
                'reuse' => Outcome::NotFound,
                'revoked' => Outcome::NotFound,
                'rotated' => Outcome::NotFound,
                'share-revoked' => Outcome::NotFound,
            ] as $variant => $outcome) {
                $cases[] = OwnershipCase::of($accept, $actor, Scope::EmailInvite, $outcome)->variant($variant);
            }
            $cases[] = OwnershipCase::of($accept, $actor, Scope::EmailInvite, Outcome::Gone)->withCode('invite_expired')->variant('expired');
        }
        $cases[] = OwnershipCase::of($accept, $anonymous, Scope::EmailInvite, Outcome::Unauthenticated);

        // Guest JWT on the routes that admit guests.
        $guest = Actor::Guest;
        foreach (['GET /files/children', 'GET /files/content'] as $op) {
            foreach (array_keys(self::GUEST_PATHS) as $variant) {
                $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, $variant === 'subtree' ? Outcome::Allowed : Outcome::NotFound)->variant($variant);
            }
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('encoded-dotdot');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('double-encoded-dotdot');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkPassword, Outcome::Allowed)->variant('subtree');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkExpired, Outcome::NotFound)->variant('after-session');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkRevoked, Outcome::NotFound)->variant('after-session');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkRevoked, Outcome::NotFound)->variant('password-changed');
        }
        $cases[] = OwnershipCase::of('GET /files/children', $guest, Scope::LinkOpen, Outcome::NotFound)->variant('file-link-parent');
        $cases[] = OwnershipCase::of('GET /files/content', $guest, Scope::LinkOpen, Outcome::Allowed)->variant('file-link');
        $cases[] = OwnershipCase::of('GET /files/content', $guest, Scope::LinkOpen, Outcome::NotFound)->variant('file-link-sibling');
        $cases[] = OwnershipCase::of('GET /files/content', $guest, Scope::LinkOpen, Outcome::NotFound)->variant('node-id-outside');

        // Link guests get no live collaboration, also inside their own subtree.
        $cases[] = OwnershipCase::of('GET /files/collaboration', $guest, Scope::LinkOpen, Outcome::Forbidden)->withCode('forbidden')->variant('subtree');
        // The collaboration routes answer every path outside a guest's rights the
        // same way, existing or not (proved in the runner with a missing path).
        $cases[] = OwnershipCase::of('GET /files/collaboration', $guest, Scope::LinkOpen, Outcome::Forbidden)->variant('sibling-prefix');
        // Public links are view-only, so a write inside the subtree is forbidden.
        $cases[] = OwnershipCase::of('PUT /files/collaboration', $guest, Scope::LinkOpen, Outcome::Forbidden)->variant('subtree');
        $cases[] = OwnershipCase::of('PUT /files/collaboration', $guest, Scope::LinkOpen, Outcome::Forbidden)->variant('sibling-prefix');

        // A guest JWT sees no more of a meeting room than an anonymous caller.
        $cases[] = OwnershipCase::of('GET /meetings/rooms/{roomId}', $guest, Scope::LinkOpen, Outcome::NotFound)->variant('closed-room');

        // Guest JMAP and guest blob upload (upload links). The gate re-checks
        // the link on every request: a view link, a link lowered to view, and
        // a session whose link expired, was revoked, or got a new password
        // all get 403 `guest_upload_forbidden` before a body is read. Signed-in
        // users keep to their own JMAP routes.
        foreach ([self::GUEST_JMAP, self::GUEST_UPLOAD] as $op) {
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, Outcome::Forbidden)->withCode('guest_upload_forbidden')->variant('view-link');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, Outcome::Forbidden)->withCode('guest_upload_forbidden')->variant('lowered-to-view');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkExpired, Outcome::Forbidden)->withCode('guest_upload_forbidden')->variant('after-session');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkRevoked, Outcome::Forbidden)->withCode('guest_upload_forbidden')->variant('after-session');
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkRevoked, Outcome::Forbidden)->withCode('guest_upload_forbidden')->variant('password-changed');
            foreach (Actor::signedIn() as $actor) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::None, Outcome::Forbidden);
            }
            $cases[] = OwnershipCase::of($op, $anonymous, Scope::None, Outcome::Unauthenticated);
        }
        // An upload link's guest reads and adds files inside its own folder only.
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::Allowed)->variant('subtree');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::Allowed)->variant('query');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('sibling-prefix');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('owner-files');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('other-link');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::Allowed)->variant('create-inside');
        // A folder the guest cannot see is an invalid parent (RFC 8620 §5.3).
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::Rejected)->variant('create-outside');
        // Upload links add files; they do not rename or delete the owner's.
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::Forbidden)->variant('destroy');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::AccountNotFound)->variant('foreign-account');
        $cases[] = OwnershipCase::of(self::GUEST_JMAP, $guest, Scope::LinkOpen, Outcome::AccountNotFound)->variant('other-session');
        $cases[] = OwnershipCase::of(self::GUEST_UPLOAD, $guest, Scope::LinkOpen, Outcome::Allowed)->variant('own-account');
        // The blob routes answer an unknown account with a 404 problem document.
        $cases[] = OwnershipCase::of(self::GUEST_UPLOAD, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('owner-account');
        $cases[] = OwnershipCase::of(self::GUEST_UPLOAD, $guest, Scope::LinkOpen, Outcome::NotFound)->variant('other-session');

        // Guest JWT on every user-role operation.
        foreach (self::roleGateOperations() as $op) {
            $cases[] = OwnershipCase::of($op, $guest, Scope::LinkOpen, Outcome::Forbidden)->variant(self::ROLE_GATE);
        }

        return $cases;
    }

    /**
     * REST operations documented or routed for the user role, then every JMAP
     * method. Pure data: reads the OpenAPI file and the method class list.
     *
     * @return list<string>
     */
    private static function roleGateOperations(): array
    {
        $rest = self::ROUTED_FOR_USERS;
        foreach (OpenApiContract::operationsWithAccess() as $operation) {
            if ($operation['access'] === 'user') {
                $rest[] = $operation['method'].' '.$operation['path'];
            }
        }
        $rest = array_values(array_unique($rest));
        sort($rest);

        $jmap = [];
        foreach (JmapMethodDispatcher::METHODS as $class) {
            /** @var JmapMethodInterface $method */
            $method = (new ReflectionClass($class))->newInstanceWithoutConstructor();
            $jmap[] = OwnershipRegistry::jmapKey($method->name());
        }
        sort($jmap);

        return array_merge($rest, $jmap);
    }

    /**
     * @return iterable<string, array{0: OwnershipCase}>
     */
    public static function casesProvider(): iterable
    {
        foreach (self::ownershipCases() as $case) {
            yield $case->key() => [$case];
        }
    }

    #[DataProvider('casesProvider')]
    public function test_ownership_case(OwnershipCase $case): void
    {
        $this->runOwnershipCase($case, fn () => $this->runCase($case));
    }

    /**
     * The owner sees the markers the guest rows assert are absent.
     */
    public function test_drive_fixture_carries_its_markers(): void
    {
        $list = fn (string $path): string => (string) $this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/files/children?path='.rawurlencode($path))->assertOk()->getContent();

        $this->assertStringContainsString(self::OUTSIDE_MARK, $list(self::SIBLING));
        $this->assertStringContainsString(self::OUTSIDE_MARK, $list(self::OTHER));
        $this->assertStringContainsString(self::BESIDE_MARK, $list(self::ROOT));
        $this->assertStringContainsString(self::OUTSIDE_MARK, $this->carolContent(self::SIBLING_DOC));
        $this->assertStringContainsString(self::OUTSIDE_MARK, $this->carolContent(self::OTHER_DOC));
        $this->assertStringContainsString(self::BESIDE_MARK, $this->carolContent(self::BRIEF));
    }

    public function test_role_gate_rows_cover_every_user_route(): void
    {
        $declared = self::roleGateOperations();
        $missing = [];
        foreach (Route::getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/v1/') || ! in_array('wgw.role:user', $route->gatherMiddleware(), true)) {
                continue;
            }
            foreach ($route->methods() as $method) {
                $key = $method.' '.substr($route->uri(), strlen('api/v1'));
                if (! in_array($method, ['HEAD', 'OPTIONS'], true) && ! in_array($key, $declared, true)) {
                    $missing[] = $key;
                }
            }
        }

        $this->assertSame([], $missing, "User-role routes without a guest role-gate row:\n".implode("\n", $missing));
    }

    private function runCase(OwnershipCase $case): void
    {
        if ($case->variant === self::ROLE_GATE) {
            $this->runRoleGate($case);

            return;
        }

        match ($case->operation) {
            'GET /calendars/feeds/{token}' => $this->runFeed($case),
            'GET /calendar/rsvp/{token}', 'POST /calendar/rsvp/{token}' => $this->runRsvp($case),
            'POST /files/share-sessions' => $this->runExchange($case),
            'POST /files/share-sessions/accept' => $this->runAccept($case),
            'GET /files/children', 'GET /files/content' => $this->runGuestRead($case),
            'GET /files/collaboration', 'PUT /files/collaboration' => $this->runGuestCollaboration($case),
            'GET /meetings/rooms/{roomId}' => $this->runGuestMeetingView($case),
            self::GUEST_JMAP, self::GUEST_UPLOAD => $this->runGuestUploadPath($case),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    // ---- Drive links ------------------------------------------------------

    /**
     * @param  array<string, mixed>  $extra
     * @return array{id: string, token: string, updatedAt: string}
     */
    private function createLink(string $path, array $extra = []): array
    {
        $response = $this->requestAsUsername(OwnershipPrincipals::CAROL, 'POST', '/files/shares', array_merge([
            'path' => $path,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ], $extra))->assertOk();

        return [
            'id' => (string) $response->json('data.id'),
            'token' => (string) $response->json('data.publicToken'),
            'updatedAt' => (string) $response->json('data.updatedAt'),
        ];
    }

    /**
     * @param  array{id: string, token: string, updatedAt: string}  $link
     * @param  array<string, mixed>  $changes
     */
    private function patchLink(array $link, array $changes): void
    {
        $this->requestAsUsername(OwnershipPrincipals::CAROL, 'PATCH', '/files/shares/'.$link['id'], array_merge(
            ['updatedAt' => $link['updatedAt']],
            $changes,
        ))->assertOk();
    }

    private function revokeLink(string $shareId): void
    {
        $this->requestAsUsername(OwnershipPrincipals::CAROL, 'DELETE', '/files/shares/'.$shareId)->assertOk();
    }

    private function exchange(string $token, ?string $password = null): TestResponse
    {
        $body = ['token' => $token];
        if ($password !== null) {
            $body['password'] = $password;
        }

        return $this->requestAs(Actor::Anonymous, 'POST', '/files/share-sessions', $body);
    }

    /**
     * Exchanges a link token for a guest JWT and uses it for Actor::Guest.
     *
     * @param  array{id: string, token: string, updatedAt: string}  $link
     */
    private function openSession(array $link, ?string $password = null): string
    {
        $token = (string) $this->exchange($link['token'], $password)->assertOk()->json('access_token');
        $this->assertNotSame('', $token);
        $this->useGuestToken($token);

        return $token;
    }

    private function carolContent(string $path): string
    {
        return $this->bodyOf($this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/files/content?path='.rawurlencode($path))->assertOk());
    }

    private function bodyOf(TestResponse $response): string
    {
        $base = $response->baseResponse;
        if ($base instanceof StreamedResponse) {
            return (string) $response->streamedContent();
        }
        if ($base instanceof BinaryFileResponse) {
            return (string) file_get_contents($base->getFile()->getPathname());
        }

        return (string) $response->getContent();
    }

    // ---- Runners: drive ---------------------------------------------------

    private function runExchange(OwnershipCase $case): void
    {
        $response = match ($case->scope) {
            Scope::LinkOpen => $case->variant === 'unknown-token'
                ? $this->exchange(bin2hex(random_bytes(16)))
                : $this->exchange($this->createLink(self::ROOT)['token']),
            Scope::LinkPassword => $this->exchange(
                $this->createLink(self::ROOT, ['password' => self::LINK_PASSWORD])['token'],
                match ($case->variant) {
                    'missing' => null,
                    'wrong' => 'not-the-password',
                    default => self::LINK_PASSWORD,
                },
            ),
            Scope::LinkExpired => $this->exchange($this->createLink(self::ROOT, ['expiresAt' => now()->subHour()->toIso8601String()])['token']),
            Scope::LinkRevoked => $this->exchangeRevoked(),
            default => throw new LogicException('No exchange target for '.$case->scope->value),
        };

        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('guest', $response->json('role'), $case->key());
            $this->assertSame(self::ROOT, $response->json('share.path'), $case->key());
            $this->assertSame('view', $response->json('share.defaultAccess'), $case->key());
        } else {
            $this->assertNull($response->json('access_token'), $case->key().': a denied exchange issued a token.');
        }
    }

    private function exchangeRevoked(): TestResponse
    {
        $link = $this->createLink(self::ROOT);
        $this->revokeLink($link['id']);

        return $this->exchange($link['token']);
    }

    /**
     * Opens a guest session for the case's scope, then ages, revokes, or
     * re-keys the link as the variant describes.
     */
    private function openGuestSessionFor(OwnershipCase $case): void
    {
        $fileLink = in_array($case->variant, ['file-link', 'file-link-parent', 'file-link-sibling'], true);
        $password = $case->scope === Scope::LinkPassword || $case->variant === 'password-changed'
            ? self::LINK_PASSWORD
            : null;
        $link = $this->createLink($fileLink ? self::DOC : self::ROOT, $password !== null ? ['password' => $password] : []);
        if ($case->variant === 'other-link') {
            $this->createLink(self::OTHER);
        }
        $this->openSession($link, $password);

        match ($case->variant) {
            'after-session' => $case->scope === Scope::LinkExpired
                ? $this->patchLink($link, ['expiresAt' => now()->subMinute()->toIso8601String()])
                : $this->revokeLink($link['id']),
            'password-changed' => $this->patchLink($link, ['password' => 'a-new-password']),
            default => null,
        };
    }

    private function runGuestRead(OwnershipCase $case): void
    {
        $this->openGuestSessionFor($case);
        $isListing = $case->operation === 'GET /files/children';
        $query = $this->guestReadQuery($case, $isListing);
        $response = $this->requestAs(Actor::Guest, 'GET', ($isListing ? '/files/children?' : '/files/content?').$query);

        $this->assertRestOutcome($response, $case);
        $body = $this->bodyOf($response);
        $this->assertStringNotContainsString(self::OUTSIDE_MARK, $body, $case->key().': content or entry from outside the shared folder in the response.');
        if (str_starts_with((string) $case->variant, 'file-link')) {
            $this->assertStringNotContainsString(self::BESIDE_MARK, $body, $case->key().': content or entry from outside the shared file in the response.');
        }
        if ($case->outcome !== Outcome::Allowed) {
            if (in_array($case->variant, ['after-session', 'password-changed'], true)) {
                $this->assertStringNotContainsString('doc.md', $body, $case->key().': entry in the response.');
                $this->assertStringNotContainsString(trim(self::DOC_BODY), $body, $case->key().': content in the response.');
                $this->assertStringNotContainsString(self::BESIDE_MARK, $body, $case->key().': content or entry in the response.');
            }
            if ($isListing) {
                $this->assertSame([], $response->json('data.files') ?? $response->json('files') ?? [], $case->key().': entries in the response.');
            }

            return;
        }

        if ($isListing) {
            $this->assertStringContainsString('doc.md', $body, $case->key());
        } else {
            $this->assertSame(self::DOC_BODY, $body, $case->key());
        }
    }

    private function guestReadQuery(OwnershipCase $case, bool $isListing): string
    {
        $variant = (string) $case->variant;
        if (isset(self::GUEST_PATHS[$variant])) {
            return 'path='.rawurlencode(self::GUEST_PATHS[$variant][$isListing ? 0 : 1]);
        }

        return match ($variant) {
            // Single-encoded dots decode to "..": the server sees a traversal.
            'encoded-dotdot' => 'path='.($isListing ? self::ROOT.'/%2e%2e/proj-secret' : self::ROOT.'/%2e%2e/proj-secret/'.rawurlencode(basename(self::SIBLING_DOC))),
            // Double-encoded dots reach the server as a literal "%2e%2e" segment.
            'double-encoded-dotdot' => 'path='.rawurlencode($isListing ? self::ROOT.'/%2e%2e/proj-secret' : self::ROOT.'/%2e%2e/proj-secret/'.basename(self::SIBLING_DOC)),
            'file-link' => 'path='.rawurlencode(self::DOC),
            'file-link-parent' => 'path='.rawurlencode(self::ROOT),
            'file-link-sibling' => 'path='.rawurlencode(self::BRIEF),
            'node-id-outside' => 'id='.rawurlencode($this->nodeIdFor(self::SIBLING_DOC)),
            'after-session', 'password-changed' => 'path='.rawurlencode($isListing ? self::ROOT : self::DOC),
            default => throw new LogicException('No guest path for '.$case->key()),
        };
    }

    private function nodeIdFor(string $virtualPath): string
    {
        $index = app(FileNodeIndexService::class);
        $key = ltrim($virtualPath, '/');
        $node = $index->liveByKey($key) ?? $index->recordCreate($key);
        $this->assertNotNull($node);

        return (string) $node->node_id;
    }

    private function runGuestCollaboration(OwnershipCase $case): void
    {
        $this->openSession($this->createLink(self::ROOT));
        $target = $case->variant === 'sibling-prefix' ? self::SIBLING_DOC : self::DOC;
        $isWrite = str_starts_with($case->operation, 'PUT ');
        $send = fn (string $path): TestResponse => $isWrite
            ? $this->putCollaboration('/api/v1/files/collaboration?path='.rawurlencode($path), "# Written by guest\n", headers: $this->headersFor(Actor::Guest))
            : $this->requestAs(Actor::Guest, 'GET', '/files/collaboration?path='.rawurlencode($path));

        $response = $isWrite
            ? $this->assertUnchanged(fn (): string => $this->carolContent($target), fn (): TestResponse => $send($target), $case->key())
            : $send($target);
        $this->assertRestOutcome($response, $case);

        $body = $this->bodyOf($response);
        $this->assertStringNotContainsString(self::OUTSIDE_MARK, $body, $case->key().': content from outside the shared folder in the response.');
        if ($response->isSuccessful()) {
            $this->assertSame(self::DOC_BODY, $body, $case->key());
        } else {
            $this->assertStringNotContainsString(trim(self::DOC_BODY), $body, $case->key().': content in a refused response.');
        }
        if ($case->variant === 'sibling-prefix') {
            $missing = $send(self::SIBLING.'/missing.md');
            $this->assertSame($response->getStatusCode(), $missing->getStatusCode(), $case->key().': existing and missing paths differ.');
            $this->assertSame($response->json(), $missing->json(), $case->key().': existing and missing paths differ.');
        }
    }

    // ---- Runners: guest JMAP and guest upload -----------------------------

    private function runGuestUploadPath(OwnershipCase $case): void
    {
        // No random blob maintenance sweep inside a measured request.
        config(['wgw.jmap.maintenance_share' => 0]);
        $isUpload = $case->operation === self::GUEST_UPLOAD;

        if ($case->scope === Scope::None) {
            $this->runGuestUploadPathSignedIn($case, $isUpload);

            return;
        }
        if ($case->outcome === Outcome::Forbidden && $case->errorCode === 'guest_upload_forbidden') {
            $this->runGuestUploadPathClosed($case, $isUpload);

            return;
        }

        $link = $this->createLink(self::ROOT, ['defaultAccess' => 'edit']);
        if ($case->variant === 'other-link') {
            $this->createLink(self::OTHER, ['defaultAccess' => 'edit']);
        }
        $token = $this->openSession($link);
        $accountId = $this->guestAccountId();
        if ($case->variant === 'other-session') {
            $this->openSession($link);
            $otherAccountId = $this->guestAccountId();
            $this->assertNotSame($accountId, $otherAccountId);
            $this->useGuestToken($token);
            $accountId = $otherAccountId;
        }

        if ($isUpload) {
            $this->runGuestBlobUpload($case, $accountId);

            return;
        }
        $this->runGuestJmapInLink($case, $accountId);
    }

    /**
     * The account a guest JWT's JMAP Session names; fails when the gate
     * refuses the session.
     */
    private function guestAccountId(): string
    {
        $accountId = (string) array_key_first((array) $this->requestAs(Actor::Guest, 'GET', '/jmap/session')->assertOk()->json('accounts'));
        $this->assertStringStartsWith('guest-', $accountId);

        return $accountId;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function guestJmapAs(Actor $actor, array $calls): TestResponse
    {
        return $this->requestAs($actor, 'POST', '/jmap/guest', ['using' => self::GUEST_USING, 'methodCalls' => $calls]);
    }

    private function guestUploadAs(Actor $actor, string $accountId, string $bytes = self::GUEST_BYTES): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/jmap/guest/upload/'.$accountId,
            server: $this->transformHeadersToServerVars(array_merge($this->headersFor($actor), [
                'Content-Type' => 'application/octet-stream',
                'Content-Length' => (string) strlen($bytes),
            ])),
            content: $bytes,
        );
    }

    /**
     * Carol's drive on disk and every stored JMAP blob: what a denied guest
     * request must leave as it was.
     *
     * @return array{0: array<string, string>, 1: list<string>, 2: list<array<string, mixed>>}
     */
    private function guestTargetSnapshot(): array
    {
        $disk = app(WgwStorage::class)->files();
        $files = [];
        foreach ($disk->allFiles('users/'.OwnershipPrincipals::CAROL) as $key) {
            $files[$key] = (string) $disk->get($key);
        }
        ksort($files);
        $directories = $disk->allDirectories('users/'.OwnershipPrincipals::CAROL);
        sort($directories);

        return [$files, $directories, JmapBlob::query()->orderBy('id')->get(['username', 'blob_id'])->toArray()];
    }

    /**
     * A view link, or a session whose upload link was lowered, expired,
     * revoked, or re-keyed after it was issued: every guest JMAP and upload
     * request is refused before anything is read or written.
     */
    private function runGuestUploadPathClosed(OwnershipCase $case, bool $isUpload): void
    {
        $password = $case->variant === 'password-changed' ? self::LINK_PASSWORD : null;
        $link = $this->createLink(self::ROOT, array_filter([
            'defaultAccess' => $case->variant === 'view-link' ? 'view' : 'edit',
            'password' => $password,
        ]));
        $this->openSession($link, $password);
        // A view link has no upload account; the request names a well-formed one.
        $accountId = $case->variant === 'view-link' ? 'guest-'.str_repeat('0', 32) : $this->guestAccountId();

        match ($case->variant) {
            'lowered-to-view' => $this->patchLink($link, ['defaultAccess' => 'view']),
            'after-session' => $case->scope === Scope::LinkExpired
                ? $this->patchLink($link, ['expiresAt' => now()->subMinute()->toIso8601String()])
                : $this->revokeLink($link['id']),
            'password-changed' => $this->patchLink($link, ['password' => 'a-new-password']),
            default => null,
        };

        $docId = $this->nodeIdFor(self::DOC);
        $response = $this->assertUnchanged(
            fn (): array => $this->guestTargetSnapshot(),
            fn (): TestResponse => $isUpload
                ? $this->guestUploadAs(Actor::Guest, $accountId)
                : $this->guestJmapAs(Actor::Guest, [
                    ['FileNode/get', ['accountId' => $accountId, 'ids' => [$docId]], 'c0'],
                    ['FileNode/set', ['accountId' => $accountId, 'destroy' => [$docId]], 'c1'],
                ]),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
        $this->assertNull($response->json('methodResponses'), $case->key().': a refused request ran its methods.');
        $this->assertNull($response->json('blobId'), $case->key().': a refused upload stored a blob.');
        $this->assertStringNotContainsString('doc.md', (string) $response->getContent(), $case->key());
    }

    /**
     * Members and admins have their own JMAP routes; the guest routes refuse
     * them at the role check, and anonymous callers at authentication.
     */
    private function runGuestUploadPathSignedIn(OwnershipCase $case, bool $isUpload): void
    {
        $accountId = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->accountIdFor($case->actor);
        $docId = $this->nodeIdFor(self::DOC);
        $response = $this->assertUnchanged(
            fn (): array => $this->guestTargetSnapshot(),
            fn (): TestResponse => $isUpload
                ? $this->guestUploadAs($case->actor, $accountId)
                : $this->guestJmapAs($case->actor, [
                    ['FileNode/get', ['accountId' => $accountId, 'ids' => [$docId]], 'c0'],
                    ['FileNode/set', ['accountId' => $accountId, 'destroy' => [$docId]], 'c1'],
                ]),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
        $this->assertNull($response->json('methodResponses'), $case->key().': a refused request ran its methods.');
        $this->assertNull($response->json('blobId'), $case->key().': a refused upload stored a blob.');
    }

    private function runGuestBlobUpload(OwnershipCase $case, string $accountId): void
    {
        if ($case->variant === 'owner-account') {
            $accountId = OwnershipPrincipals::CAROL;
        }

        if ($case->outcome === Outcome::Allowed) {
            $response = $this->guestUploadAs(Actor::Guest, $accountId);
            $response->assertCreated();
            $this->assertSame($accountId, $response->json('accountId'), $case->key());
            $owners = JmapBlob::query()->where('blob_id', (string) $response->json('blobId'))->pluck('username')->all();
            $this->assertSame([$accountId], $owners, $case->key().': the blob landed outside the guest account.');

            return;
        }

        $response = $this->assertUnchanged(
            fn (): array => $this->guestTargetSnapshot(),
            fn (): TestResponse => $this->guestUploadAs(Actor::Guest, $accountId),
            $case->key(),
        );
        $this->assertSame(404, $response->getStatusCode(), $case->key().' returned '.$response->getStatusCode().': '.substr((string) $response->getContent(), 0, 200));
        $this->assertNull($response->json('blobId'), $case->key());
    }

    private function runGuestJmapInLink(OwnershipCase $case, string $accountId): void
    {
        $docId = $this->nodeIdFor(self::DOC);

        switch ($case->variant) {
            case 'subtree':
                $response = $this->guestJmapAs(Actor::Guest, [['FileNode/get', ['accountId' => $accountId, 'ids' => [$docId]], 'c0']]);
                $this->assertJmapGetOutcome($response, $docId, $case);
                $this->assertSame('doc.md', $response->json('methodResponses.0.1.list.0.name'), $case->key());

                return;
            case 'sibling-prefix':
            case 'owner-files':
            case 'other-link':
                $targetPath = $case->variant === 'sibling-prefix' ? self::SIBLING_DOC : self::OTHER_DOC;
                $targetId = $this->nodeIdFor($targetPath);
                $folderId = $this->nodeIdFor(dirname($targetPath));
                $response = $this->guestJmapAs(Actor::Guest, [['FileNode/get', ['accountId' => $accountId, 'ids' => [$targetId, $folderId]], 'c0']]);
                $this->assertJmapGetOutcome($response, $targetId, $case);
                $this->assertJmapGetOutcome($response, $folderId, $case);
                $this->assertStringNotContainsString(self::OUTSIDE_MARK, (string) $response->getContent(), $case->key());

                return;
            case 'query':
                $this->runGuestQuery($case, $accountId);

                return;
            case 'foreign-account':
            case 'other-session':
                $target = $case->variant === 'foreign-account' ? OwnershipPrincipals::CAROL : $accountId;
                $response = $this->guestJmapAs(Actor::Guest, [['FileNode/get', ['accountId' => $target, 'ids' => [$docId]], 'c0']]);
                $this->assertJmapGetOutcome($response, $docId, $case);
                $this->assertStringNotContainsString('doc.md', (string) $response->getContent(), $case->key());

                return;
        }

        $this->runGuestNodeSet($case, $accountId, $docId);
    }

    /**
     * The guest's top level is the shared folder alone; nothing beside it
     * shows up, also when asked for a folder outside it.
     */
    private function runGuestQuery(OwnershipCase $case, string $accountId): void
    {
        $denied = [
            $this->nodeIdFor(self::SIBLING),
            $this->nodeIdFor(self::SIBLING_DOC),
            $this->nodeIdFor(self::OTHER),
            $this->nodeIdFor(self::OTHER_DOC),
        ];
        $response = $this->guestJmapAs(Actor::Guest, [
            ['FileNode/query', ['accountId' => $accountId, 'filter' => ['isTopLevel' => true]], 'c0'],
            ['FileNode/query', ['accountId' => $accountId, 'filter' => ['parentId' => $this->nodeIdFor(self::SIBLING)]], 'c1'],
        ])->assertOk();

        $this->assertSame([$this->nodeIdFor(self::ROOT)], $response->json('methodResponses.0.1.ids'), $case->key());
        $outside = $response->json('methodResponses.1.1.ids');
        $this->assertIdsAbsent($denied, is_array($outside) ? $outside : [], $case->key());
        $this->assertStringNotContainsString(self::OUTSIDE_MARK, (string) $response->getContent(), $case->key());
    }

    private function runGuestNodeSet(OwnershipCase $case, string $accountId, string $docId): void
    {
        $disk = app(WgwStorage::class)->files();
        $blobId = (string) $this->guestUploadAs(Actor::Guest, $accountId)->assertCreated()->json('blobId');
        $name = 'guest-'.uniqid().'.txt';

        if ($case->variant === 'create-inside') {
            $response = $this->guestJmapAs(Actor::Guest, [['FileNode/set', ['accountId' => $accountId, 'create' => [
                'f' => ['parentId' => $this->nodeIdFor(self::ROOT), 'name' => $name, 'blobId' => $blobId],
            ]], 'c0']]);
            $this->assertJmapSetOutcome($response, 'create', 'f', $case);
            $this->assertSame(self::GUEST_BYTES, $disk->get(ltrim(self::ROOT, '/').'/'.$name), $case->key());

            return;
        }

        $calls = $case->variant === 'create-outside'
            ? [['FileNode/set', ['accountId' => $accountId, 'create' => [
                'f' => ['parentId' => $this->nodeIdFor(self::SIBLING), 'name' => $name, 'blobId' => $blobId],
            ]], 'c0']]
            : [['FileNode/set', ['accountId' => $accountId, 'update' => [$docId => ['name' => $name]], 'destroy' => [$docId]], 'c0']];
        $response = $this->assertUnchanged(
            fn (): array => $this->guestTargetSnapshot(),
            fn (): TestResponse => $this->guestJmapAs(Actor::Guest, $calls),
            $case->key(),
        );

        if ($case->variant === 'create-outside') {
            $this->assertJmapSetOutcome($response, 'create', 'f', $case);
            $this->assertFalse($disk->fileExists(ltrim(self::SIBLING, '/').'/'.$name), $case->key());

            return;
        }
        $this->assertJmapSetOutcome($response, 'update', $docId, $case);
        $this->assertJmapSetOutcome($response, 'destroy', $docId, $case);
    }

    // ---- Runners: email invites -------------------------------------------

    /**
     * @return array{shareId: string, inviteId: string, inviteToken: string}
     */
    private function createInvite(string $path, string $email): array
    {
        $shareId = (string) $this->requestAsUsername(OwnershipPrincipals::CAROL, 'POST', '/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.id');

        return ['shareId' => $shareId] + $this->sendInvite($shareId, $email);
    }

    /**
     * @return array{inviteId: string, inviteToken: string}
     */
    private function sendInvite(string $shareId, string $email): array
    {
        $invite = $this->requestAsUsername(OwnershipPrincipals::CAROL, 'POST', '/files/shares/'.$shareId.'/invites', [
            'email' => $email,
            'access' => 'view',
        ]);
        $invite->assertSuccessful();

        return ['inviteId' => (string) $invite->json('data.id'), 'inviteToken' => (string) $invite->json('data.inviteToken')];
    }

    private function runAccept(OwnershipCase $case): void
    {
        $invite = $this->createInvite(self::ROOT, 'invitee@elsewhere.test');
        $send = fn (string $token): TestResponse => $this->requestAs($case->actor, 'POST', '/files/share-sessions/accept', ['inviteToken' => $token]);

        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send($invite['inviteToken']), $case);

            return;
        }

        $token = $invite['inviteToken'];
        switch ($case->variant) {
            case 'other-invite':
                $token = $this->createInvite(self::OTHER, 'second@elsewhere.test')['inviteToken'];
                break;
            case 'reuse':
                $this->requestAsUsername(OwnershipPrincipals::DAVE, 'POST', '/files/share-sessions/accept', ['inviteToken' => $token])->assertOk();
                break;
            case 'revoked':
                $this->requestAsUsername(OwnershipPrincipals::CAROL, 'DELETE', '/files/shares/'.$invite['shareId'].'/invites/'.$invite['inviteId'])->assertSuccessful();
                break;
            case 'rotated':
                $this->sendInvite($invite['shareId'], 'invitee@elsewhere.test');
                break;
            case 'expired':
                // The API cannot set an invite expiry, so the row is aged directly.
                DriveShareGrant::query()->whereKey($invite['inviteId'])->update(['invite_expires_at' => now()->subMinute()]);
                break;
            case 'share-revoked':
                $this->revokeLink($invite['shareId']);
                break;
        }

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send($token), $case);
            $granted = $case->variant === 'other-invite' ? self::OTHER : self::ROOT;
            $notGranted = $case->variant === 'other-invite' ? self::ROOT : self::OTHER;
            $this->assertActorReaches($case, $granted, true);
            $this->assertActorReaches($case, $notGranted, false);
            $this->assertActorReaches($case, self::SIBLING, false);
            // The invite grants view only.
            $write = $this->putCollaboration('/api/v1/files/collaboration?path='.rawurlencode($granted.'/'.basename($granted === self::ROOT ? self::DOC : self::OTHER_DOC)), "# Written\n", headers: $this->headersFor($case->actor));
            $this->assertSame(403, $write->getStatusCode(), $case->key().': a view invite allowed a write.');

            return;
        }

        $response = $this->assertUnchanged(
            fn (): mixed => $this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/files/shares/'.$invite['shareId'])->json(),
            fn (): TestResponse => $send($token),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
        $this->assertActorReaches($case, self::ROOT, false);
        if ($case->variant === 'reuse') {
            $dave = $this->requestAsUsername(OwnershipPrincipals::DAVE, 'GET', '/files/children?path='.rawurlencode(self::ROOT));
            $this->assertSame(200, $dave->getStatusCode(), $case->key().': the first acceptor lost access.');
        }
    }

    private function assertActorReaches(OwnershipCase $case, string $path, bool $expected): void
    {
        $status = $this->requestAs($case->actor, 'GET', '/files/children?path='.rawurlencode($path))->getStatusCode();
        $this->assertSame($expected, $status === 200, $case->key().': '.$path.' returned '.$status.'.');
    }

    // ---- Runners: calendar feed -------------------------------------------

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function carolJmap(array $methodCalls): TestResponse
    {
        return $this->requestAsUsername(OwnershipPrincipals::CAROL, 'POST', '/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }

    private function createCalendar(string $name): string
    {
        $id = (string) $this->carolJmap([
            ['Calendar/set', ['accountId' => OwnershipPrincipals::CAROL, 'create' => ['c' => ['name' => $name]]], 'c0'],
        ])->json('methodResponses.0.1.created.c.id');
        $this->assertNotSame('', $id);

        return $id;
    }

    private function importEvent(string $calendarId, string $uid, string $summary, ?string $class = null): void
    {
        $classLine = $class !== null ? "CLASS:{$class}\r\n" : '';
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ownership//EN\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\n"
            ."DTSTAMP:20300101T000000Z\r\nDTSTART:20300110T090000Z\r\nDTEND:20300110T100000Z\r\n"
            ."SUMMARY:{$summary}\r\n{$classLine}END:VEVENT\r\nEND:VCALENDAR\r\n";

        $this->call('POST', '/api/v1/calendars/events/import?calendarId='.rawurlencode($calendarId), [], [], [], [
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->mintUserToken(OwnershipPrincipals::CAROL, 'user'),
            'CONTENT_TYPE' => 'text/calendar',
            'HTTP_ACCEPT' => 'application/json',
        ], $ics)->assertCreated();
    }

    private function publishFeed(string $calendarId): string
    {
        $url = (string) $this->requestAsUsername(OwnershipPrincipals::CAROL, 'POST', '/calendars/'.$calendarId.'/feed')
            ->assertSuccessful()
            ->json('httpsUrl');
        $this->assertSame(1, preg_match('#/calendars/feeds/([A-Za-z0-9]+)$#', $url, $match), $url);

        return $match[1];
    }

    private function runFeed(OwnershipCase $case): void
    {
        $calendarA = $this->createCalendar('Feed A');
        $calendarB = $this->createCalendar('Feed B');
        $this->importEvent($calendarA, 'feed-public-a@ownership.test', 'Feed public A');
        $this->importEvent($calendarA, 'feed-private-a@ownership.test', 'Feed private A', 'PRIVATE');
        $this->importEvent($calendarA, 'feed-unclassified-a@ownership.test', 'Feed unclassified A', 'X-UNLISTED');
        $this->importEvent($calendarB, 'feed-only-b@ownership.test', 'Feed only B');
        $tokenA = $this->publishFeed($calendarA);

        $token = $tokenA;
        switch ($case->variant) {
            case 'other-calendar':
                $token = $this->publishFeed($calendarB);
                break;
            case 'unknown':
                $token = strtolower(bin2hex(random_bytes(24)));
                break;
            case 'revoked':
                $this->requestAsUsername(OwnershipPrincipals::CAROL, 'DELETE', '/calendars/'.$calendarA.'/feed')->assertNoContent();
                break;
            case 'rotated':
                $this->requestAsUsername(OwnershipPrincipals::CAROL, 'DELETE', '/calendars/'.$calendarA.'/feed')->assertNoContent();
                $fresh = $this->publishFeed($calendarA);
                $this->assertNotSame($tokenA, $fresh);
                $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$fresh)->assertOk();
                break;
            case 'deleted-calendar':
                $this->carolJmap([
                    ['Calendar/set', ['accountId' => OwnershipPrincipals::CAROL, 'destroy' => [$calendarA], 'onDestroyRemoveEvents' => true], 'c0'],
                ]);
                break;
            case 'as-bearer':
                $response = $this->json('GET', '/api/v1/jmap/session', [], ['Authorization' => 'Bearer '.$tokenA]);
                $this->assertRestOutcome($response, $case);
                $this->assertRestOutcome($this->json('GET', '/api/v1/me', [], ['Authorization' => 'Bearer '.$tokenA]), $case);

                return;
        }

        $response = $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$token);
        $this->assertRestOutcome($response, $case);
        $ics = (string) $response->getContent();
        if ($case->outcome !== Outcome::Allowed) {
            $this->assertStringNotContainsString('BEGIN:VCALENDAR', $ics, $case->key());

            return;
        }

        if ($case->variant === 'other-calendar') {
            $this->assertStringContainsString('SUMMARY:Feed only B', $ics, $case->key());
            $this->assertStringNotContainsString('Feed public A', $ics, $case->key().': another calendar in the feed.');

            return;
        }
        $this->assertStringContainsString('SUMMARY:Feed public A', $ics, $case->key());
        $this->assertStringNotContainsString('Feed only B', $ics, $case->key().': another calendar in the feed.');
        $this->assertStringNotContainsString('Feed private A', $ics, $case->key().': private event not redacted.');
        $this->assertStringNotContainsString('Feed unclassified A', $ics, $case->key().': unclassified event not redacted.');
    }

    // ---- Runners: RSVP ----------------------------------------------------

    private function enableExternalInvites(): void
    {
        Mail::fake();
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'calendar@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
        $this->app->instance(MailDeliveryTransportResolver::class, new MailDeliveryTransportResolver(
            phpMailProbe: static fn (): bool => true,
            sendmailProbe: static fn (): bool => true,
        ));
    }

    /**
     * @param  list<string>  $attendees
     */
    private function inviteExternal(string $calendarId, string $title, array $attendees): string
    {
        $participants = ['org' => ['@type' => 'Participant', 'email' => 'carol@example.test', 'roles' => ['owner']]];
        foreach ($attendees as $index => $email) {
            $participants['att'.$index] = [
                '@type' => 'Participant',
                'email' => $email,
                'roles' => ['attendee'],
                'expectReply' => true,
                'participationStatus' => 'needs-action',
            ];
        }

        $id = (string) $this->carolJmap([
            ['CalendarEvent/set', ['accountId' => OwnershipPrincipals::CAROL, 'create' => ['e' => [
                'calendarIds' => [$calendarId => true],
                'title' => $title,
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T11:00:00Z',
                'participants' => $participants,
            ]]], 'c0'],
        ])->json('methodResponses.0.1.created.e.id');
        $this->assertNotSame('', $id);

        return $id;
    }

    private function rsvpToken(string $email, string $title): string
    {
        $sent = Mail::sent(OutboundMessageMail::class, static fn (OutboundMessageMail $mail): bool => $mail->outbound->calendarMethod === 'REQUEST'
            && in_array($email, $mail->outbound->to, true)
            && $mail->outbound->subject === 'Invitation: '.$title);
        $this->assertFalse($sent->isEmpty(), 'No invitation for '.$email.' to '.$title);
        $mail = $sent->last();
        $this->assertInstanceOf(OutboundMessageMail::class, $mail);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $mail->outbound->textBody, $match));

        return $match[1];
    }

    /**
     * Carol's view of an event's attendee replies: email => participationStatus.
     *
     * @return array<string, string>
     */
    private function replies(string $eventId): array
    {
        $event = $this->carolJmap([
            ['CalendarEvent/get', ['accountId' => OwnershipPrincipals::CAROL, 'ids' => [$eventId]], 'c0'],
        ])->json('methodResponses.0.1.list.0');
        $this->assertIsArray($event);
        $replies = [];
        foreach ((array) ($event['participants'] ?? []) as $participant) {
            if (! is_array($participant)) {
                continue;
            }
            $roles = (array) ($participant['roles'] ?? []);
            $roleNames = array_is_list($roles) ? $roles : array_keys(array_filter($roles));
            if (in_array('attendee', $roleNames, true)) {
                $replies[strtolower((string) ($participant['email'] ?? ''))] = (string) ($participant['participationStatus'] ?? 'needs-action');
            }
        }
        ksort($replies);

        return $replies;
    }

    private function runRsvp(OwnershipCase $case): void
    {
        $this->enableExternalInvites();
        $calendarId = $this->createCalendar('Invites');
        $first = 'first@elsewhere.test';
        $second = 'second@elsewhere.test';
        $eventId = $this->inviteExternal($calendarId, 'Planning A', [$first, $second]);
        $otherEventId = $this->inviteExternal($calendarId, 'Unrelated plan B', [$first]);
        $token = $this->rsvpToken($first, 'Planning A');

        if ($case->variant === 'tampered') {
            $token = substr($token, 0, -1).($token[strlen($token) - 1] === 'a' ? 'b' : 'a');
        }
        if ($case->variant === 'superseded') {
            $this->carolJmap([
                ['CalendarEvent/set', ['accountId' => OwnershipPrincipals::CAROL, 'update' => [$eventId => [
                    'start' => '2030-03-02T10:00:00Z',
                    'end' => '2030-03-02T11:00:00Z',
                ]]], 'c0'],
            ]);
            $this->assertNotSame($token, $this->rsvpToken($first, 'Planning A'), $case->key().': the update sent no new invitation.');
        }

        $snapshot = fn (): array => [$this->replies($eventId), $this->replies($otherEventId)];
        $before = $snapshot();

        if (str_starts_with($case->operation, 'GET ')) {
            $response = $this->requestAs(Actor::Anonymous, 'GET', '/calendar/rsvp/'.$token);
            $this->assertRestOutcome($response, $case);
            if ($case->outcome === Outcome::Allowed) {
                $body = (array) $response->json();
                ksort($body);
                $this->assertSame(['attendeeEmail' => $first, 'participationStatus' => 'needs-action', 'title' => 'Planning A'], $body, $case->key());
            }
            $this->assertStringNotContainsString('Unrelated plan B', (string) $response->getContent(), $case->key());
            $this->assertStringNotContainsString($second, (string) $response->getContent(), $case->key());
            $this->assertSame($before, $snapshot(), $case->key().': a read changed a reply.');

            return;
        }

        $body = ['participationStatus' => 'declined'];
        if ($case->variant === 'other-attendee') {
            $body += ['attendeeEmail' => $second, 'email' => $second, 'participantId' => 'att1', 'calendarId' => $calendarId];
        }

        if ($case->outcome !== Outcome::Allowed) {
            $response = $this->assertUnchanged($snapshot, fn (): TestResponse => $this->requestAs(Actor::Anonymous, 'POST', '/calendar/rsvp/'.$token, $body), $case->key());
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response = $this->requestAs(Actor::Anonymous, 'POST', '/calendar/rsvp/'.$token, $body);
        $this->assertRestOutcome($response, $case);
        [$replies, $otherReplies] = $snapshot();
        $this->assertSame('declined', $replies[$first] ?? null, $case->key());
        $this->assertSame($before[0][$second] ?? null, $replies[$second] ?? null, $case->key().': another attendee was answered.');
        $this->assertSame($before[1], $otherReplies, $case->key().': another event was answered.');
    }

    // ---- Runners: role gate -----------------------------------------------

    private function runRoleGate(OwnershipCase $case): void
    {
        $this->openSession($this->createLink(self::ROOT));

        if (str_starts_with($case->operation, 'JMAP ')) {
            $response = $this->requestAs(Actor::Guest, 'POST', '/jmap', [
                'using' => [JmapCapabilities::CORE],
                'methodCalls' => [[substr($case->operation, strlen('JMAP ')), ['accountId' => OwnershipPrincipals::CAROL], 'c0']],
            ]);
            $this->assertRestOutcome($response, $case);

            return;
        }

        if (str_starts_with($case->operation, 'POST /meetings/rooms') || str_starts_with($case->operation, 'PATCH /meetings/rooms/')) {
            $this->runMeetingRoleGate($case);

            return;
        }

        [$method, $path] = explode(' ', $case->operation, 2);
        $query = OpenApiContract::sampleQueryString($path, $method);
        $uri = OpenApiContract::sampleRequestPath($path).($query !== '' ? '?'.$query : '');
        $this->assertRestOutcome($this->requestAs(Actor::Guest, $method, $uri), $case);
    }

    private function reserveMemberRoom(string $room): void
    {
        $this->requestAs(Actor::Member, 'POST', '/meetings/rooms', [
            'room' => $room,
            'ownerPrincipal' => 'u:'.OwnershipPrincipals::MEMBER,
            'expiresAt' => '2031-01-01T00:00:00Z',
        ])->assertCreated();
    }

    /**
     * A plain room name is closed to callers without an account.
     */
    private function runGuestMeetingView(OwnershipCase $case): void
    {
        $room = 'crew-standup-room';
        $this->reserveMemberRoom($room);
        $this->requestAs(Actor::Anonymous, 'GET', '/meetings/rooms/'.$room)->assertNotFound();
        $this->openSession($this->createLink(self::ROOT));

        $response = $this->requestAs(Actor::Guest, 'GET', '/meetings/rooms/'.$room);
        $this->assertRestOutcome($response, $case);
        $this->assertStringNotContainsString(OwnershipPrincipals::MEMBER, (string) $response->getContent(), $case->key());
    }

    /**
     * Meeting reservations send a valid body, so the outcome does not depend
     * on request validation.
     */
    private function runMeetingRoleGate(OwnershipCase $case): void
    {
        $room = 'crew-standup-room';
        $view = fn (): array => [
            $this->requestAs(Actor::Member, 'GET', '/meetings/rooms/'.$room)->getStatusCode(),
            $this->requestAs(Actor::Member, 'GET', '/meetings/rooms/'.$room)->json('expiresAt'),
        ];

        if (str_starts_with($case->operation, 'POST ')) {
            $response = $this->assertUnchanged($view, fn (): TestResponse => $this->requestAs(Actor::Guest, 'POST', '/meetings/rooms', [
                'room' => $room,
                'ownerPrincipal' => 'groups/'.OwnershipPrincipals::CREW,
            ]), $case->key());
            $this->assertRestOutcome($response, $case);

            return;
        }

        $this->reserveMemberRoom($room);
        $response = $this->assertUnchanged($view, fn (): TestResponse => $this->requestAs(Actor::Guest, 'PATCH', '/meetings/rooms/'.$room, [
            'expiresAt' => null,
        ]), $case->key());
        $this->assertRestOutcome($response, $case);
    }
}
