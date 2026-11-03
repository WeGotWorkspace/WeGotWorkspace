<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\JmapBlob;
use App\Models\JmapBlobAssembly;
use App\Models\JmapDownloadTicket;
use App\Models\User;
use App\Services\Auth\JwtTokenService;
use App\Services\Auth\RefreshTokenRepository;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Ownership matrix for the drive REST API, drive share management, JMAP
 * FileNode methods, JMAP blob upload/download, download tickets, the RFC 9404
 * Blob methods and blob assemblies (plan chunk-g-drive).
 *
 * Each case seeds one folder holding one document in the tree its scope
 * names. Grant scopes are carol's folder (or, for `group-to-nonmember-*`, an
 * `outsiders` folder) shared to the actor at a drive level. The `*-read`
 * scopes use `view` (variant `level-comment` uses `comment`); `*-write` and
 * `user-to-actor-group` use `edit` (variant `level-full` uses `full`).
 * `edit` reaches content only; structure (rename, delete, create) needs
 * `full`. Drive has no way for a sharee to dismiss a grant, so
 * `grant-dismissed` has no rows here.
 *
 * Share management is addressed by the share owner: for `own-group`, the
 * target share is one the actor created on a `crew` folder, and the
 * `peer-share` variant is one dave created there.
 */
final class DriveOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;
    use SendsFramedCollaboration;

    private const USING = [JmapCapabilities::CORE, JmapCapabilities::FILENODE];

    /** Reads addressed by path, node id, or blob id: allowed when the actor can view the target. */
    private const READ_OPS = [
        'GET /files',
        'GET /files/children',
        'GET /files/content',
        'GET /files/collaboration',
        'POST /files/rooms',
        'POST /files/star',
        'DELETE /files/star',
        'GET /jmap/download/{accountId}/{blobId}/{name}',
        'POST /files/download-tickets',
        'POST /jmap/download-tickets/{accountId}',
        'JMAP FileNode/get',
        'JMAP FileNode/changes',
        'JMAP FileNode/query',
    ];

    private const SHARE_ID_OPS = [
        'GET /files/shares/{shareId}',
        'PATCH /files/shares/{shareId}',
        'DELETE /files/shares/{shareId}',
        'POST /files/shares/{shareId}/invites',
        'DELETE /files/shares/{shareId}/invites/{inviteId}',
    ];

    /** Paths that step out of a shared folder: `..`, a literal `%2e%2e`, the owner's own tree, and a sibling sharing the folder's prefix. */
    private const TRAVERSAL_VARIANTS = [
        'GET /files/children' => ['traversal', 'owner-tree', 'sibling-prefix'],
        'GET /files/content' => ['traversal', 'encoded-traversal', 'owner-tree', 'sibling-prefix'],
        'GET /files/collaboration' => ['traversal', 'sibling-prefix'],
        'PUT /files/collaboration' => ['traversal', 'sibling-prefix'],
        'POST /files/rooms' => ['traversal'],
        'POST /files/download-tickets' => ['traversal', 'encoded-traversal', 'owner-tree', 'sibling-prefix'],
    ];

    private const TRAVERSAL = ['traversal', 'encoded-traversal', 'owner-tree', 'sibling-prefix'];

    private const COLLAB_OPS = ['GET /files/collaboration', 'PUT /files/collaboration'];

    private const LEVEL_OPS = [
        'GET /files/children',
        'GET /files/content',
        'GET /files/collaboration',
        'PUT /files/collaboration',
    ];

    private const SET_VARIANTS = ['content', 'rename', 'destroy', 'create-child'];

    /** Operations whose ACL is one path check; they run a narrower scope set. */
    private const NARROW_OPS = ['POST /files/rooms', 'POST /files/star', 'DELETE /files/star'];

    private const NARROW_SCOPES = [
        Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::FormerGroup,
        Scope::UserToActorRead, Scope::GrantRevoked,
    ];

    /** Every REST operation of this suite, for the anonymous rows. */
    private const REST_OPS = [
        'GET /files',
        'GET /files/children',
        'GET /files/content',
        'GET /files/collaboration',
        'PUT /files/collaboration',
        'GET /files/shared-with-me',
        'GET /files/shares',
        'POST /files/shares',
        'GET /files/shares/at-path',
        'GET /files/shares/by-principal',
        'GET /files/shares/principals',
        'POST /files/shares/public/revoke-all',
        'GET /files/shares/{shareId}',
        'PATCH /files/shares/{shareId}',
        'DELETE /files/shares/{shareId}',
        'POST /files/shares/{shareId}/invites',
        'DELETE /files/shares/{shareId}/invites/{inviteId}',
        'POST /files/star',
        'DELETE /files/star',
        'GET /files/starred',
        'POST /files/rooms',
        'GET /jmap/download/{accountId}/{blobId}/{name}',
        'POST /jmap/upload/{accountId}',
        'POST /files/download-tickets',
        'POST /jmap/download-tickets/{accountId}',
    ];

    private const TICKET_OPS = ['POST /files/download-tickets', 'POST /jmap/download-tickets/{accountId}'];

    private const BLOB_OPS = ['JMAP Blob/get', 'JMAP Blob/upload'];

    private const ASSEMBLY_OPS = ['JMAP BlobAssembly/set', 'JMAP BlobAssembly/get', 'JMAP BlobAssembly/append', 'JMAP BlobAssembly/finish'];

    /** An assembly id no account holds, for proving another account's id answers the same. */
    private const UNKNOWN_ASSEMBLY = 'ba-00000000000000000000000000000000';

    private const RANK = ['view' => 1, 'comment' => 2, 'edit' => 4, 'full' => 5];

    private const UNKNOWN_PRINCIPAL = 'no-such-principal';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = storage_path('framework/testing/wgw-ownership-drive-'.uniqid('', true));
        foreach (['users/member', 'users/admin', 'users/carol', 'users/dave', 'groups/crew', 'groups/outsiders', 'groups/alumni'] as $dir) {
            File::ensureDirectoryExists($this->dataDir.'/files/'.$dir);
        }
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();
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
        foreach (Actor::signedIn() as $actor) {
            foreach (self::scopesFor($actor) as $scope) {
                $level = self::levelOf($scope, null);
                $invisible = $level === null;
                // Group grants and the second user grant reach share management through the same owner check as user-to-actor-*.
                $shareManaged = ! in_array($scope, [Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite, Scope::UserToActorGroup], true);
                foreach (self::READ_OPS as $op) {
                    if (in_array($op, self::NARROW_OPS, true) && ! in_array($scope, self::NARROW_SCOPES, true)) {
                        continue;
                    }
                    $cases[] = OwnershipCase::of($op, $actor, $scope, self::readOutcome($level));
                }
                $cases[] = OwnershipCase::of('PUT /files/collaboration', $actor, $scope, self::writeOutcome($level, 'edit'));
                foreach (self::SET_VARIANTS as $variant) {
                    // For an invisible node, update and destroy share one lookup; other-user keeps both.
                    if ($invisible && ($variant === 'content' || ($variant === 'rename' && $scope !== Scope::OtherUser))) {
                        continue;
                    }
                    $cases[] = OwnershipCase::of('JMAP FileNode/set', $actor, $scope, self::writeOutcome($level, $variant === 'content' ? 'edit' : 'full'))
                        ->variant($variant);
                }
                $cases[] = OwnershipCase::of('GET /files/shares/at-path', $actor, $scope, $invisible ? Outcome::Forbidden : Outcome::Allowed);
                if (! self::isOwn($scope)) {
                    $cases[] = OwnershipCase::of('GET /files/shared-with-me', $actor, $scope, self::readOutcome($level));
                }
                if (! $shareManaged) {
                    continue;
                }
                foreach (self::SHARE_ID_OPS as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, self::shareManagementOutcome($scope));
                }
                foreach (['GET /files/shares', 'GET /files/shares/by-principal'] as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, self::isOwn($scope) ? Outcome::Allowed : Outcome::NotFound);
                }
                foreach (['POST /files/shares', 'POST /files/shares/public/revoke-all'] as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, self::isOwn($scope) ? Outcome::Allowed : Outcome::Forbidden);
                }
            }

            foreach ([...self::SHARE_ID_OPS, 'GET /files/shares', 'GET /files/shares/by-principal'] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OwnGroup, Outcome::NotFound)->variant('peer-share');
            }
            $cases[] = OwnershipCase::of('GET /files/shares/by-principal', $actor, Scope::OtherUser, Outcome::Forbidden)->variant('scope');

            foreach ([Scope::OwnUser, Scope::OwnGroup, Scope::FormerGroup] as $scope) {
                $cases[] = OwnershipCase::of('GET /files/starred', $actor, $scope, self::isOwn($scope) ? Outcome::Allowed : Outcome::NotFound);
            }

            // The share dialog directory: the actor's own group is listed; principals it shares nothing with are not.
            $cases[] = OwnershipCase::of('GET /files/shares/principals', $actor, Scope::OwnGroup, Outcome::Allowed);
            // The share directory lists every user and group of the instance.
            $cases[] = OwnershipCase::of('GET /files/shares/principals', $actor, Scope::OtherUser, Outcome::Allowed);
            $cases[] = OwnershipCase::of('GET /files/shares/principals', $actor, Scope::OtherGroup, Outcome::Allowed);

            $cases[] = OwnershipCase::of('POST /jmap/upload/{accountId}', $actor, Scope::OwnUser, Outcome::Allowed);
            $cases[] = OwnershipCase::of('POST /jmap/upload/{accountId}', $actor, Scope::OtherUser, Outcome::NotFound);
            $cases[] = OwnershipCase::of('GET /jmap/download/{accountId}/{blobId}/{name}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('foreign-account');
            $cases[] = OwnershipCase::of('GET /jmap/download/{accountId}/{blobId}/{name}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('envelope-blob');
            $cases[] = OwnershipCase::of('POST /jmap/download-tickets/{accountId}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('foreign-account');
            $cases[] = OwnershipCase::of('POST /jmap/download-tickets/{accountId}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('envelope-blob');
            $cases = [...$cases, ...self::blobCases($actor)];

            foreach (['JMAP FileNode/get', 'JMAP FileNode/changes', 'JMAP FileNode/query', 'JMAP FileNode/set', 'JMAP FileNode/queryChanges'] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
            }
            // queryChanges answers cannotCalculateChanges for every query of
            // the caller's own account; it returns no ids.
            $cases[] = OwnershipCase::of('JMAP FileNode/queryChanges', $actor, Scope::OwnUser, Outcome::Allowed);
            $cases[] = OwnershipCase::of('JMAP FileNode/copy', $actor, Scope::OtherUser, Outcome::AccountNotFound)
                ->withCode('fromAccountNotFound')->variant('source');
            $cases[] = OwnershipCase::of('JMAP FileNode/copy', $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('destination');
        }

        $cases = [...$cases, ...self::memberOnlyVariants()];

        foreach (self::REST_OPS as $op) {
            $cases[] = OwnershipCase::of($op, Actor::Anonymous, Scope::None, Outcome::Unauthenticated);
        }
        // Collaboration rooms are members-only; a guest session gets the role gate.
        $cases[] = OwnershipCase::of('POST /files/rooms', Actor::Guest, Scope::None, Outcome::Forbidden);

        return array_map(self::applyDecidedExceptions(...), $cases);
    }

    /**
     * Path traversal, drive levels, file shares, and node-id addressing.
     *
     * @return list<OwnershipCase>
     */
    private static function memberOnlyVariants(): array
    {
        $member = Actor::Member;
        $cases = [];
        foreach (self::TRAVERSAL_VARIANTS as $op => $variants) {
            foreach ($variants as $variant) {
                $cases[] = OwnershipCase::of($op, $member, Scope::UserToActorRead, Outcome::NotFound)->variant($variant);
            }
        }

        foreach ([[Scope::UserToActorRead, 'level-comment'], [Scope::UserToActorWrite, 'level-full']] as [$scope, $variant]) {
            $level = self::levelOf($scope, $variant);
            foreach (self::LEVEL_OPS as $op) {
                $outcome = $op === 'PUT /files/collaboration' ? self::writeOutcome($level, 'edit') : self::readOutcome($level);
                $cases[] = OwnershipCase::of($op, $member, $scope, $outcome)->variant($variant);
            }
            foreach (self::SET_VARIANTS as $setVariant) {
                $cases[] = OwnershipCase::of('JMAP FileNode/set', $member, $scope, self::writeOutcome($level, $setVariant === 'content' ? 'edit' : 'full'))
                    ->variant($setVariant.' '.$variant);
            }
            $cases[] = OwnershipCase::of('POST /files/shares', $member, $scope, Outcome::Forbidden)->variant($variant);
        }

        // The drive roots list every home and group drive, like the share
        // directory; the actor has no rights on another owner's entry.
        $cases[] = OwnershipCase::of('GET /files/children', $member, Scope::OtherUser, Outcome::Allowed)->variant('drive-roots');
        $cases[] = OwnershipCase::of('GET /files/children', $member, Scope::OtherGroup, Outcome::Allowed)->variant('drive-roots');

        // A grant on one outsiders folder reaches no other folder of that group.
        foreach (['GET /files/children', 'GET /files/content'] as $op) {
            $cases[] = OwnershipCase::of($op, $member, Scope::GroupToNonmemberWrite, Outcome::NotFound)->variant('group-sibling');
        }

        // Only the document is shared: the folder around it stays hidden.
        $cases[] = OwnershipCase::of('GET /files/content', $member, Scope::UserToActorRead, Outcome::Allowed)->variant('file-share');
        $cases[] = OwnershipCase::of('GET /files/children', $member, Scope::UserToActorRead, Outcome::NotFound)->variant('file-share');

        foreach ([Scope::OwnUser, Scope::OtherUser, Scope::UserToActorRead, Scope::GrantRevoked] as $scope) {
            $cases[] = OwnershipCase::of('GET /files/content', $member, $scope, self::readOutcome(self::levelOf($scope, null)))->variant('node-id');
        }

        // A ticket re-checks access on every request: one minted while the
        // actor could read the file stops serving once that access ends.
        $cases[] = OwnershipCase::of('POST /files/download-tickets', $member, Scope::GrantRevoked, Outcome::NotFound)->variant('after-issue');
        $cases[] = OwnershipCase::of('POST /files/download-tickets', $member, Scope::FormerGroup, Outcome::NotFound)->variant('after-issue');
        $cases[] = OwnershipCase::of('POST /jmap/download-tickets/{accountId}', $member, Scope::GrantRevoked, Outcome::NotFound)->variant('after-issue');
        // A ticket serves only the blob it was minted for, whatever name the URL carries.
        $cases[] = OwnershipCase::of('POST /jmap/download-tickets/{accountId}', $member, Scope::OwnUser, Outcome::Allowed)->variant('other-name');

        // Group membership is checked per request: leaving `crew` ends the access.
        $cases[] = OwnershipCase::of('GET /files/children', $member, Scope::UserToActorGroup, Outcome::NotFound)->variant('left-crew');

        // Moving the actor's own document into a folder of the scope.
        $cases[] = OwnershipCase::of('JMAP FileNode/set', $member, Scope::OtherUser, Outcome::NotFound)->variant('move-into');
        $cases[] = OwnershipCase::of('JMAP FileNode/set', $member, Scope::UserToActorRead, Outcome::Forbidden)->variant('move-into');

        return $cases;
    }

    /**
     * Blob/get, Blob/upload and blob assemblies live in the caller's own
     * account: other-user is carol's uploaded blob or assembly addressed
     * from the actor's account (`file-blob`: carol's drive file blob).
     * Blob/upload and BlobAssembly/append name a source blob, which the
     * methods report as `blobNotFound` (RFC 8621) when the account does not
     * hold it. The admin runs the denied rows only.
     *
     * @return list<OwnershipCase>
     */
    private static function blobCases(Actor $actor): array
    {
        $own = $actor === Actor::Member;
        $cases = [];
        foreach (self::BLOB_OPS as $op) {
            if ($own) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OwnUser, Outcome::Allowed);
            }
            foreach ([null, 'file-blob'] as $variant) {
                $case = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::NotFound);
                $case = $op === 'JMAP Blob/upload' ? $case->withCode('blobNotFound') : $case;
                $cases[] = $variant === null ? $case : $case->variant($variant);
            }
            $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }

        foreach (self::ASSEMBLY_OPS as $op) {
            $set = $op === 'JMAP BlobAssembly/set';
            if ($own) {
                $case = OwnershipCase::of($op, $actor, Scope::OwnUser, Outcome::Allowed);
                $cases[] = $set ? $case->variant('destroy') : $case;
                if ($set) {
                    $cases[] = $case->variant('create');
                }
            }
            $case = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::NotFound);
            $cases[] = $set ? $case->variant('destroy') : $case;
            $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }
        // The actor's own assembly, with carol's blob as a part.
        $cases[] = OwnershipCase::of('JMAP BlobAssembly/append', $actor, Scope::OtherUser, Outcome::NotFound)
            ->withCode('blobNotFound')->variant('part');

        return $cases;
    }

    /**
     * Rows where a decided exception in the spec replaces the default outcome.
     */
    private static function applyDecidedExceptions(OwnershipCase $case): OwnershipCase
    {
        // RFC 8620 §5.3: a parent the caller cannot see is an invalid property of the
        // create or move, not a missing record.
        if ($case->operation === 'JMAP FileNode/set' && $case->outcome === Outcome::NotFound
            && in_array($case->variant, ['create-child', 'move-into'], true)) {
            return $case->declared(Outcome::Rejected);
        }

        return $case;
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

    // ---- Case data -------------------------------------------------------

    /**
     * @return list<Scope>
     */
    private static function scopesFor(Actor $actor): array
    {
        if ($actor === Actor::Admin) {
            // No admin bypass: drive rights ignore the admin role, so the admin runs the two denied scopes.
            return [Scope::OtherUser, Scope::FormerGroup];
        }

        return [
            Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup,
            Scope::UserToActorRead, Scope::UserToActorWrite,
            // group-to-nonmember-read differs from -write only by level, which the user-to-actor rows cover.
            Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup, Scope::GrantRevoked,
        ];
    }

    private static function isOwn(Scope $scope): bool
    {
        return $scope === Scope::OwnUser || $scope === Scope::OwnGroup;
    }

    private static function isSharee(Scope $scope): bool
    {
        return in_array($scope, [
            Scope::UserToActorRead, Scope::UserToActorWrite,
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup,
        ], true);
    }

    private static function isGrantScope(Scope $scope): bool
    {
        return self::isSharee($scope) || $scope === Scope::GrantRevoked;
    }

    /**
     * The drive level the actor holds on the target, or null when it holds none.
     */
    private static function levelOf(Scope $scope, ?string $variant): ?string
    {
        if (self::isOwn($scope)) {
            return 'full';
        }
        if ($variant !== null && str_contains($variant, 'level-comment')) {
            return 'comment';
        }
        if ($variant !== null && str_contains($variant, 'level-full')) {
            return 'full';
        }

        return match ($scope) {
            Scope::UserToActorRead, Scope::GroupToNonmemberRead => 'view',
            Scope::UserToActorWrite, Scope::GroupToNonmemberWrite, Scope::UserToActorGroup => 'edit',
            default => null,
        };
    }

    private static function readOutcome(?string $level): Outcome
    {
        return $level === null ? Outcome::NotFound : Outcome::Allowed;
    }

    private static function writeOutcome(?string $level, string $required): Outcome
    {
        if ($level === null) {
            return Outcome::NotFound;
        }

        return self::RANK[$level] >= self::RANK[$required] ? Outcome::Allowed : Outcome::Forbidden;
    }

    private static function shareManagementOutcome(Scope $scope): Outcome
    {
        if (self::isOwn($scope)) {
            return Outcome::Allowed;
        }

        return self::isSharee($scope) ? Outcome::Forbidden : Outcome::NotFound;
    }

    private static function needsShare(OwnershipCase $case): bool
    {
        return self::isGrantScope($case->scope) || in_array($case->operation, [
            ...self::SHARE_ID_OPS,
            'GET /files/shares',
            'GET /files/shares/by-principal',
            'GET /files/shares/at-path',
            'GET /files/shared-with-me',
        ], true);
    }

    // ---- Dispatch --------------------------------------------------------

    private function runCase(OwnershipCase $case): void
    {
        if ($case->scope === Scope::None) {
            $this->runRoleGate($case);

            return;
        }
        $this->seedOwnershipWorld();

        match ($case->operation) {
            'POST /files/download-tickets', 'POST /jmap/download-tickets/{accountId}' => $this->runTicket($case),
            'JMAP Blob/get', 'JMAP Blob/upload' => $this->runBlob($case),
            'JMAP BlobAssembly/set', 'JMAP BlobAssembly/get', 'JMAP BlobAssembly/append', 'JMAP BlobAssembly/finish' => $this->runAssembly($case),
            'GET /files/shares/principals' => $this->runPrincipals($case),
            'POST /jmap/upload/{accountId}' => $this->runUpload($case),
            'JMAP FileNode/copy' => $this->runCopy($case),
            'JMAP FileNode/queryChanges' => $this->runQueryChanges($case),
            'JMAP FileNode/changes' => $this->runChanges($case),
            default => $this->runTargetCase($case),
        };
    }

    private function runTargetCase(OwnershipCase $case): void
    {
        $target = $this->seedTarget($case);
        if ($case->variant === 'left-crew') {
            $this->runLeftCrew($case, $target);

            return;
        }

        match ($case->operation) {
            'GET /files' => $this->runSearch($case, $target),
            'GET /files/children' => $this->runChildren($case, $target),
            'GET /files/content' => $this->runContent($case, $target),
            'GET /files/collaboration' => $this->runCollabRead($case, $target),
            'PUT /files/collaboration' => $this->runCollabWrite($case, $target),
            'POST /files/rooms' => $this->runRoom($case, $target),
            'POST /files/star', 'DELETE /files/star' => $this->runStar($case, $target),
            'GET /files/starred' => $this->runStarred($case, $target),
            'GET /files/shared-with-me' => $this->runSharedWithMe($case, $target),
            'GET /files/shares' => $this->runShareIndex($case, $target),
            'GET /files/shares/by-principal' => $this->runByPrincipal($case, $target),
            'GET /files/shares/at-path' => $this->runAtPath($case, $target),
            'POST /files/shares' => $this->runCreateShare($case, $target),
            'POST /files/shares/public/revoke-all' => $this->runRevokeAll($case, $target),
            'GET /files/shares/{shareId}' => $this->runShareShow($case, $target),
            'PATCH /files/shares/{shareId}' => $this->runSharePatch($case, $target),
            'DELETE /files/shares/{shareId}' => $this->runShareDelete($case, $target),
            'POST /files/shares/{shareId}/invites' => $this->runInviteCreate($case, $target),
            'DELETE /files/shares/{shareId}/invites/{inviteId}' => $this->runInviteDelete($case, $target),
            'GET /jmap/download/{accountId}/{blobId}/{name}' => $this->runDownload($case, $target),
            'JMAP FileNode/get' => $this->runNodeGet($case, $target),
            'JMAP FileNode/query' => $this->runNodeQuery($case, $target),
            'JMAP FileNode/set' => $this->runNodeSet($case, $target),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runLeftCrew(OwnershipCase $case, array $target): void
    {
        $uri = '/files/children?path='.rawurlencode($target['folder']);
        $this->assertContains($target['docName'], $this->entryNames($this->requestAs($case->actor, 'GET', $uri)), $case->key());

        $this->assertUnchanged(fn () => $this->ownerSnapshot($target), fn () => $this->leaveCrew($case->actor), $case->key());

        // Same token as before leaving.
        $response = $this->requestAs($case->actor, 'GET', $uri);
        $this->assertTargetHidden($response, $target, $case);
        $this->assertRestOutcome($response, $case);
        $this->assertContains($target['docName'], $this->entryNames($this->requestAsUsername(OwnershipPrincipals::DAVE, 'GET', $uri)), $case->key().': dave lost access.');
    }

    // ---- Target seeding --------------------------------------------------

    /**
     * @return array{
     *   owner: string, folder: string, doc: string, docName: string, body: string, yjs: string,
     *   shareId: string|null, shareCreator: string|null, grantee: string|null,
     *   inviteId: string|null, linkId: string|null, peerLinkId: string|null
     * }
     */
    private function seedTarget(OwnershipCase $case): array
    {
        $scope = $case->scope;
        $self = $this->usernameFor($case->actor);
        $other = $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin);
        $carol = OwnershipPrincipals::CAROL;
        $dave = OwnershipPrincipals::DAVE;

        [$owner, $folder] = match ($scope) {
            Scope::OwnUser => [$self, '/users/'.$self.'/box'],
            Scope::OwnGroup => [$dave, '/groups/crew/box'],
            Scope::OtherUser => [$carol, '/users/carol/box'],
            Scope::OtherGroup => [$carol, '/groups/outsiders/box'],
            // The other actor stays in alumni, so the owner's view still works after this actor leaves.
            Scope::FormerGroup => $case->operation === 'GET /files/shared-with-me'
                ? [$carol, '/users/carol/box']
                : [$other, '/groups/alumni/box'],
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, '/groups/outsiders/shared'],
            default => [$carol, '/users/carol/shared'],
        };

        $docName = 'doc-'.$scope->value.'.md';
        $doc = $folder.'/'.$docName;
        $body = '# body of '.$scope->value."\n";
        $yjs = 'yjs state of '.$scope->value;
        $disk = app(WgwStorage::class)->files();
        $disk->put(ltrim($doc, '/'), $body);
        if (in_array($case->variant, self::TRAVERSAL, true)) {
            $disk->put('users/carol/private/secret.md', "carol private\n");
            $disk->put('users/carol/shared-secret/secret.md', "carol sibling\n");
        }
        if (in_array($case->operation, self::COLLAB_OPS, true)) {
            // Collaboration sidecars (`.{name}.yjs`), as a saved session leaves them.
            $disk->put(ltrim($folder, '/').'/.'.$docName.'.yjs', $yjs);
            $disk->put('users/carol/private/.secret.md.yjs', 'carol private yjs state');
            $disk->put('users/carol/shared-secret/.secret.md.yjs', 'carol sibling yjs state');
        }
        if ($case->variant === 'group-sibling') {
            $disk->put('groups/outsiders/private/secret.md', "carol private\n");
        }

        $target = [
            'owner' => $owner, 'folder' => $folder, 'doc' => $doc, 'docName' => $docName, 'body' => $body, 'yjs' => $yjs,
            'shareId' => null, 'shareCreator' => null, 'grantee' => null,
            'inviteId' => null, 'linkId' => null, 'peerLinkId' => null,
        ];

        if (self::needsShare($case)) {
            [$creator, $shareWith, $grantee] = $this->sharePlan($case, $self);
            $sharePath = $case->variant === 'file-share' ? $doc : $folder;
            $target['shareId'] = $this->createShare($creator, $sharePath, 'member', $shareWith);
            $target['shareCreator'] = $creator;
            $target['grantee'] = $grantee;
        }

        if ($case->operation === 'DELETE /files/shares/{shareId}/invites/{inviteId}') {
            $target['inviteId'] = (string) $this->requestAsUsername((string) $target['shareCreator'], 'POST', '/files/shares/'.$target['shareId'].'/invites', [
                'email' => 'guest@example.com',
                'access' => 'view',
            ])->assertOk()->json('data.id');
        }

        if ($case->operation === 'POST /files/shares/public/revoke-all') {
            $linkOwner = match ($scope) {
                Scope::OwnUser, Scope::OwnGroup, Scope::FormerGroup => $self,
                default => $carol,
            };
            $target['linkId'] = $this->createShare($linkOwner, $folder, 'public');
            if ($scope === Scope::OwnGroup) {
                $target['peerLinkId'] = $this->createShare($dave, $folder, 'public');
            }
        }

        if (in_array($case->operation, ['GET /files/starred', 'DELETE /files/star'], true)
            && ($scope === Scope::FormerGroup || self::isOwn($scope))) {
            $this->requestAs($case->actor, 'POST', '/files/star?path='.rawurlencode($doc))->assertOk();
        }
        // The owner's own star on the target, which no other user's star request may touch.
        if (in_array($case->operation, ['POST /files/star', 'DELETE /files/star'], true) && $owner !== $self) {
            $this->requestAsUsername($owner, 'POST', '/files/star?path='.rawurlencode($doc))->assertOk();
        }

        // `after-issue` rows end the access themselves, after minting a ticket.
        if ($case->variant !== 'after-issue') {
            $this->endScopeAccess($case, $target);
        }

        return $target;
    }

    /**
     * Revokes the grant-revoked share, or removes the actor from alumni.
     *
     * @param  array{shareId: string|null}  $target
     */
    private function endScopeAccess(OwnershipCase $case, array $target): void
    {
        if ($case->scope === Scope::GrantRevoked) {
            $this->requestAsUsername(OwnershipPrincipals::CAROL, 'DELETE', '/files/shares/'.$target['shareId'])->assertOk();
        }
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }
    }

    /**
     * Who creates the scope's share, whom it grants, and the grantee the
     * by-principal query names.
     *
     * @return array{0: string, 1: array<string, array{access: string}>, 2: string}
     */
    private function sharePlan(OwnershipCase $case, string $self): array
    {
        $carol = OwnershipPrincipals::CAROL;
        $dave = OwnershipPrincipals::DAVE;
        $scope = $case->scope;

        if (self::isGrantScope($scope)) {
            $level = self::levelOf($scope === Scope::GrantRevoked ? Scope::UserToActorWrite : $scope, $case->variant) ?? 'edit';
            $grantee = $scope === Scope::UserToActorGroup ? 'groups/'.OwnershipPrincipals::CREW : $self;

            return [$carol, [$grantee => ['access' => $level], $dave => ['access' => 'view']], $dave];
        }

        return match ($scope) {
            Scope::OwnUser => [$self, [$dave => ['access' => 'view']], $dave],
            Scope::OwnGroup => $case->variant === 'peer-share'
                ? [$dave, [$carol => ['access' => 'view']], $carol]
                : [$self, [$dave => ['access' => 'view']], $dave],
            Scope::FormerGroup => $case->operation === 'GET /files/shared-with-me'
                ? [$carol, ['groups/'.OwnershipPrincipals::ALUMNI => ['access' => 'view']], $dave]
                : [$self, [$dave => ['access' => 'view']], $dave],
            // other-user, other-group: carol grants dave, never the actor.
            default => [$carol, [$dave => ['access' => 'view']], $dave],
        };
    }

    /**
     * @param  array<string, array{access: string}>  $shareWith
     */
    private function createShare(string $creator, string $path, string $kind, array $shareWith = []): string
    {
        $payload = ['path' => $path, 'kind' => $kind, 'defaultAccess' => 'view'];
        if ($shareWith !== []) {
            $payload['shareWith'] = $shareWith;
        }

        return (string) $this->requestAsUsername($creator, 'POST', '/files/shares', $payload)->assertOk()->json('data.id');
    }

    /**
     * The owner's FileNode view of the target document and its folder.
     *
     * @param  array{owner: string, docName: string}  $target
     * @return array{docId: string, folderId: string, blobId: string}
     */
    private function nodesOf(array $target): array
    {
        $owner = $target['owner'];
        $list = $this->requestAsUsername($owner, 'POST', '/jmap', [
            'using' => self::USING,
            'methodCalls' => [['FileNode/get', ['accountId' => $owner, 'ids' => null], 'c0']],
        ])->assertOk()->json('methodResponses.0.1.list');
        foreach (is_array($list) ? $list : [] as $node) {
            if (($node['name'] ?? null) === $target['docName']) {
                return ['docId' => (string) $node['id'], 'folderId' => (string) $node['parentId'], 'blobId' => (string) $node['blobId']];
            }
        }

        $this->fail($owner.' has no FileNode named '.$target['docName']);
    }

    /**
     * The owner's view of the target, for proving a denied write changed nothing.
     *
     * @param  array{owner: string, folder: string, doc: string, shareId: string|null}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target): array
    {
        $content = $this->requestAsUsername($target['owner'], 'GET', '/files/content?path='.rawurlencode($target['doc']));
        $children = $this->requestAsUsername($target['owner'], 'GET', '/files/children?path='.rawurlencode($target['folder']));

        return [
            'docStatus' => $content->getStatusCode(),
            'doc' => $this->bodyOf($content),
            'children' => $this->entryNames($children),
            'share' => $target['shareId'] === null ? null : $this->shareRecord($target['shareId']),
        ];
    }

    /**
     * The stored share and its grants. Read from the store, because the
     * share owner may be the actor under test (former-group).
     *
     * @return array<string, mixed>|null
     */
    private function shareRecord(string $shareId): ?array
    {
        $share = DriveShare::query()->find($shareId);
        if ($share === null) {
            return null;
        }
        $grants = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->orderBy('id')
            ->get(['grantee_type', 'grantee_user', 'grantee_group', 'grantee_email', 'access', 'status'])
            ->toArray();

        return [
            'path' => $share->path,
            'kind' => $share->kind,
            'defaultAccess' => $share->default_access,
            'revoked' => $share->revoked_at !== null,
            'password' => $share->password_hash,
            'expiresAt' => $share->expires_at?->toISOString(),
            'grants' => $grants,
        ];
    }

    // ---- Small helpers ---------------------------------------------------

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

    /**
     * @return list<string>
     */
    private function entryNames(TestResponse $response): array
    {
        if ($response->getStatusCode() !== 200) {
            return [];
        }
        $names = array_map('strval', array_column((array) $response->json('data.files'), 'name'));
        sort($names);

        return $names;
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function rawAs(Actor $actor, string $method, string $uri, string $content, array $headers = []): TestResponse
    {
        return $this->call(
            $method,
            '/api/v1'.$uri,
            server: $this->transformHeadersToServerVars(array_merge($this->headersFor($actor), $headers)),
            content: $content,
        );
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function jmap(Actor $actor, array $calls): TestResponse
    {
        return $this->jmapAs($actor, $calls, self::USING);
    }

    private function uploadBlob(Actor $actor, string $accountId, string $contents): TestResponse
    {
        return $this->rawAs($actor, 'POST', '/jmap/upload/'.$accountId, $contents, ['Content-Type' => 'text/markdown']);
    }

    /**
     * The path a case sends: the target, or a traversal or sibling of it.
     *
     * @param  array{folder: string, doc: string}  $target
     */
    private function pathFor(OwnershipCase $case, array $target, bool $wantsFile): string
    {
        $suffix = $wantsFile ? '/secret.md' : '';

        return match ($case->variant) {
            'traversal' => $target['folder'].'/../private'.$suffix,
            // Sent literally: the app receives "%2e%2e", not "..".
            'encoded-traversal' => $target['folder'].'/%2e%2e/private'.$suffix,
            'owner-tree' => '/users/carol/private'.$suffix,
            'sibling-prefix' => $target['folder'].'-secret'.$suffix,
            'group-sibling' => '/groups/outsiders/private'.$suffix,
            default => $wantsFile ? $target['doc'] : $target['folder'],
        };
    }

    /**
     * No body, collaboration state or name of the target, or of carol's
     * private and sibling files, may appear in a denied response.
     *
     * @param  array{body: string, yjs: string, docName: string}  $target
     */
    private function assertTargetHidden(TestResponse $response, array $target, OwnershipCase $case): void
    {
        $content = $this->bodyOf($response);
        foreach ([$target['body'], $target['yjs'], 'carol private', 'carol sibling', 'secret.md', $target['docName']] as $needle) {
            $this->assertStringNotContainsString($needle, $content, $case->key().': denied response reveals '.$needle);
        }
    }

    /**
     * A 403 for a target the actor cannot see is only right when an unknown
     * target gets the same answer.
     */
    private function assertSameAsUnknown(TestResponse $response, callable $sendUnknown, OwnershipCase $case): void
    {
        if ($case->outcome !== Outcome::Forbidden || self::levelOf($case->scope, $case->variant) !== null) {
            return;
        }
        /** @var TestResponse $unknown */
        $unknown = $sendUnknown();
        $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown targets differ.');
        $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown targets differ.');
    }

    private function unknownTwin(string $path): string
    {
        $segments = explode('/', ltrim($path, '/'));
        $segments[1] = self::UNKNOWN_PRINCIPAL;

        return '/'.implode('/', $segments);
    }

    // ---- Runners: role gate and target-free operations ------------------

    private function runRoleGate(OwnershipCase $case): void
    {
        [$method, $route] = explode(' ', $case->operation, 2);
        $uri = strtr($route, [
            '{shareId}' => '00000000-0000-4000-8000-000000000000',
            '{inviteId}' => '00000000-0000-4000-8000-000000000001',
            '{accountId}' => OwnershipPrincipals::MEMBER,
            '{blobId}' => 'jb-0000',
            '{name}' => 'file.txt',
        ]);
        $query = match ($route) {
            '/files' => '?search=doc',
            '/files/shares/by-principal' => '?principal=dave',
            '/files/shares/principals' => '?query=a',
            '/files/shared-with-me', '/files/shares', '/files/starred' => '',
            default => str_contains($route, '{') ? '' : '?path='.rawurlencode('/users/member/box'),
        };
        $response = $this->requestAs($case->actor, $method, $uri.$query);
        $this->assertRestOutcome($response, $case);
    }

    private function runPrincipals(OwnershipCase $case): void
    {
        [$query, $principal] = match ($case->scope) {
            Scope::OwnGroup => ['crew', 'groups/crew'],
            Scope::OtherUser => ['carol', 'carol'],
            Scope::OtherGroup => ['outsiders', 'groups/outsiders'],
            default => throw new LogicException('No principal for '.$case->scope->value),
        };
        $response = $this->requestAs($case->actor, 'GET', '/files/shares/principals?query='.$query);
        $response->assertOk();
        $listed = array_map('strval', array_column((array) $response->json('data'), 'principal'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($principal, $listed, $case->key());

            return;
        }
        $this->assertIdsAbsent([$principal], $listed, $case->key());
    }

    private function runUpload(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $carol = OwnershipPrincipals::CAROL;
        $contents = 'uploaded by '.$self.' '.uniqid();
        $accountId = $case->scope === Scope::OwnUser ? $self : $carol;
        $response = $this->uploadBlob($case->actor, $accountId, $contents);

        if ($case->outcome === Outcome::Allowed) {
            $response->assertCreated();
            $this->assertSame($self, $response->json('accountId'), $case->key());

            return;
        }
        $this->assertBlobNotFound($response, $case);
        // Content-addressed: had the upload landed in carol's account, carol could download this id.
        $blobId = 'jb-'.substr(hash('sha256', $contents), 0, 40);
        $this->requestAsUsername($carol, 'GET', '/jmap/download/carol/'.$blobId.'/x.txt')->assertNotFound();
    }

    private function runCopy(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $carol = OwnershipPrincipals::CAROL;
        $target = $this->seedTarget($case);
        $nodes = $this->nodesOf($target);
        [$from, $into] = $case->variant === 'source' ? [$carol, $self] : [$self, $carol];

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->jmap($case->actor, [
                ['FileNode/copy', ['fromAccountId' => $from, 'accountId' => $into, 'create' => [
                    'k1' => ['id' => $nodes['docId'], 'parentId' => $nodes['folderId']],
                ]], 'c0'],
            ]),
            $case->key(),
        );
        $this->assertJmapMethodError($response, $case->errorCode ?? 'accountNotFound', $case);
    }

    private function runQueryChanges(OwnershipCase $case): void
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $this->usernameFor($case->actor);
        $response = $this->jmap($case->actor, [
            ['FileNode/queryChanges', ['accountId' => $accountId, 'sinceQueryState' => '0'], 'c0'],
        ]);
        $this->assertJmapMethodError($response, $case->outcome === Outcome::AccountNotFound ? 'accountNotFound' : 'cannotCalculateChanges', $case);
    }

    private function runChanges(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $since = (string) $this->jmap($case->actor, [
            ['FileNode/get', ['accountId' => $self, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
        $target = $this->seedTarget($case);
        $docId = $this->nodesOf($target)['docId'];

        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $self;
        $response = $this->jmap($case->actor, [
            ['FileNode/changes', ['accountId' => $accountId, 'sinceState' => $since], 'c0'],
        ]);
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }
        $response->assertOk();
        $changed = array_map('strval', array_merge(
            (array) $response->json('methodResponses.0.1.created'),
            (array) $response->json('methodResponses.0.1.updated'),
        ));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($docId, $changed, $case->key());

            return;
        }
        $this->assertIdsAbsent([$docId], $changed, $case->key());
    }

    // ---- Runners: path-addressed REST ------------------------------------

    /**
     * @param  array<string, mixed>  $target
     */
    private function runSearch(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/files?search='.rawurlencode('doc-'.$case->scope->value));
        $response->assertOk();
        $paths = array_map('strval', array_column((array) $response->json('data.files'), 'path'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['doc'], $paths, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['doc']], $paths, $case->key());
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runChildren(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'drive-roots') {
            $root = $case->scope === Scope::OtherGroup ? '/groups' : '/users';
            $response = $this->requestAs($case->actor, 'GET', '/files/children?path='.$root);
            $response->assertOk();
            $foreign = $root.'/'.($case->scope === Scope::OtherGroup ? OwnershipPrincipals::OUTSIDERS : OwnershipPrincipals::CAROL);
            $entries = array_column((array) $response->json('data.files'), null, 'path');
            $this->assertArrayHasKey($foreign, $entries, $case->key());
            $rights = (array) ($entries[$foreign]['myRights'] ?? []);
            $this->assertNotEmpty($rights, $case->key());
            $this->assertSame([], array_keys(array_filter($rights)), $case->key().': rights on another owner\'s drive.');

            return;
        }
        $response = $this->requestAs($case->actor, 'GET', '/files/children?path='.rawurlencode($this->pathFor($case, $target, false)));
        if ($case->outcome !== Outcome::Allowed) {
            $this->assertTargetHidden($response, $target, $case);
        }
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['docName'], $this->entryNames($response), $case->key());
        }
        if ($case->variant === 'traversal' && $response->getStatusCode() === 200) {
            // A listing for `..` holds the drive roots only, nothing from the owner's tree.
            $this->assertSame(['groups', 'users'], $this->entryNames($response), $case->key());
        }
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runContent(OwnershipCase $case, array $target): void
    {
        $uri = $case->variant === 'node-id'
            ? '/files/content?id='.rawurlencode($this->nodesOf($target)['docId'])
            : '/files/content?path='.rawurlencode($this->pathFor($case, $target, true));
        $response = $this->requestAs($case->actor, 'GET', $uri);
        if ($case->outcome !== Outcome::Allowed) {
            $this->assertTargetHidden($response, $target, $case);
        }
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['body'], $this->bodyOf($response), $case->key());
        }
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runCollabRead(OwnershipCase $case, array $target): void
    {
        $uri = '/files/collaboration?path='.rawurlencode($this->pathFor($case, $target, true));
        // The markdown text, then the Yjs snapshot of the same document.
        foreach (['' => $target['body'], '&format=yjs' => $target['yjs']] as $format => $expected) {
            $response = $this->requestAs($case->actor, 'GET', $uri.$format);
            if ($case->outcome !== Outcome::Allowed) {
                $this->assertTargetHidden($response, $target, $case);
            }
            $this->assertRestOutcome($response, $case);
            if ($case->outcome === Outcome::Allowed) {
                $this->assertSame($expected, $this->bodyOf($response), $case->key().$format);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runCollabWrite(OwnershipCase $case, array $target): void
    {
        $path = $this->pathFor($case, $target, true);
        $markdown = "# written by actor\n";
        $send = fn (): TestResponse => $this->putCollaboration(
            '/api/v1/files/collaboration?path='.rawurlencode($path),
            $markdown,
            headers: $this->headersFor($case->actor),
        );

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $this->assertSame($markdown, $this->ownerSnapshot($target)['doc'], $case->key().': write did not land.');

            return;
        }
        $disk = app(WgwStorage::class)->files();
        $stored = fn (string $key): ?string => $disk->fileExists($key) ? $disk->get($key) : null;
        $response = $this->assertUnchanged(
            fn () => [
                $this->ownerSnapshot($target),
                $stored(ltrim($target['folder'], '/').'/.'.$target['docName'].'.yjs'),
                $stored('users/carol/private/secret.md'),
                $stored('users/carol/private/.secret.md.yjs'),
                $stored('users/carol/shared-secret/secret.md'),
                $stored('users/carol/shared-secret/.secret.md.yjs'),
            ],
            $send,
            $case->key(),
        );
        $this->assertTargetHidden($response, $target, $case);
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runRoom(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'POST', '/files/rooms?path='.rawurlencode($this->pathFor($case, $target, true)));
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertIsString($response->json('roomId'), $case->key());
        }
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runStar(OwnershipCase $case, array $target): void
    {
        [$method] = explode(' ', $case->operation, 2);
        $self = $this->usernameFor($case->actor);
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, '/files/star?path='.rawurlencode($target['doc']));
        // Stars are per user: the owner's own star never moves, and a refused request leaves the actor's as they were.
        $stars = fn (): array => [
            'owner' => $target['owner'] === $self ? null : $this->requestAsUsername($target['owner'], 'GET', '/files/starred')->json('data.paths'),
            'actor' => $case->outcome === Outcome::Allowed ? null : $this->requestAs($case->actor, 'GET', '/files/starred')->json('data.paths'),
        ];
        $response = $this->assertUnchanged($stars, $send, $case->key());
        if ($case->outcome !== Outcome::Allowed) {
            $this->assertTargetHidden($response, $target, $case);
        }
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runStarred(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/files/starred');
        $response->assertOk();
        $paths = array_map('strval', (array) $response->json('data.paths'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['doc'], $paths, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['doc']], $paths, $case->key());
    }

    // ---- Runners: share management ---------------------------------------

    /**
     * @param  array<string, mixed>  $target
     */
    private function runSharedWithMe(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/files/shared-with-me');
        $response->assertOk();
        $ids = array_map('strval', array_column(array_column((array) $response->json('data'), 'share'), 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['shareId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([(string) $target['shareId']], $ids, $case->key());
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runShareIndex(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/files/shares');
        $response->assertOk();
        $ids = array_map('strval', array_column((array) $response->json('data'), 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['shareId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([(string) $target['shareId']], $ids, $case->key());
        $filtered = $this->requestAs($case->actor, 'GET', '/files/shares?path='.rawurlencode($target['folder']));
        $filtered->assertOk();
        $this->assertIdsAbsent([(string) $target['shareId']], array_map('strval', array_column((array) $filtered->json('data'), 'id')), $case->key().' (path filter)');
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runByPrincipal(OwnershipCase $case, array $target): void
    {
        $query = '/files/shares/by-principal?principal='.rawurlencode((string) $target['grantee']);
        if ($case->variant === 'scope') {
            $response = $this->requestAs($case->actor, 'GET', $query.'&scope='.rawurlencode($target['folder']));
            $this->assertTargetHidden($response, $target, $case);
            $this->assertStringNotContainsString((string) $target['shareId'], (string) $response->getContent(), $case->key());
            $this->assertRestOutcome($response, $case);
            $this->assertSameAsUnknown($response, fn () => $this->requestAs($case->actor, 'GET', $query.'&scope='.rawurlencode($this->unknownTwin($target['folder']))), $case);

            return;
        }

        $response = $this->requestAs($case->actor, 'GET', $query);
        $response->assertOk();
        $content = (string) $response->getContent();
        if ($case->outcome === Outcome::Allowed) {
            $this->assertStringContainsString((string) $target['shareId'], $content, $case->key());

            return;
        }
        $this->assertStringNotContainsString((string) $target['shareId'], $content, $case->key().': share of another owner listed.');
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runAtPath(OwnershipCase $case, array $target): void
    {
        $send = fn (string $path): TestResponse => $this->requestAs($case->actor, 'GET', '/files/shares/at-path?path='.rawurlencode($path));
        $response = $send($target['folder']);
        $this->assertRestOutcome($response, $case);
        $content = (string) $response->getContent();

        if ($case->outcome === Outcome::Allowed && self::isOwn($case->scope)) {
            $this->assertStringContainsString((string) $target['shareId'], $content, $case->key());

            return;
        }
        // A sharee sees its own rights only; nobody else's share or grantees.
        $this->assertStringNotContainsString((string) $target['shareId'], $content, $case->key().': share id present.');
        $this->assertStringNotContainsString('"dave"', $content, $case->key().': other grantee present.');
        if ($case->outcome === Outcome::Allowed) {
            $this->assertTrue((bool) $response->json('data.myRights.mayView'), $case->key());
        }
        $this->assertSameAsUnknown($response, fn () => $send($this->unknownTwin($target['folder'])), $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runCreateShare(OwnershipCase $case, array $target): void
    {
        $dave = OwnershipPrincipals::DAVE;
        $send = fn (string $path): TestResponse => $this->requestAs($case->actor, 'POST', '/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [$dave => ['access' => 'view']],
        ]);
        $daveSees = fn (): array => array_map('strval', array_column(array_column(
            (array) $this->requestAsUsername($dave, 'GET', '/files/shared-with-me')->json('data'),
            'share',
        ), 'path'));

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send($target['folder']), $case);
            $this->assertContains($target['folder'], $daveSees(), $case->key().': share did not reach dave.');

            return;
        }
        $response = $this->assertUnchanged($daveSees, fn () => $send($target['folder']), $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertSameAsUnknown($response, fn () => $send($this->unknownTwin($target['folder'])), $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runRevokeAll(OwnershipCase $case, array $target): void
    {
        $send = fn (string $path): TestResponse => $this->requestAs($case->actor, 'POST', '/files/shares/public/revoke-all?path='.rawurlencode($path));
        $peer = fn (): ?array => $target['peerLinkId'] === null ? null : $this->shareRecord((string) $target['peerLinkId']);

        if ($case->outcome === Outcome::Allowed) {
            // Only the actor's own link goes; dave's link on the same group folder stays.
            $response = $this->assertUnchanged($peer, fn () => $send($target['folder']), $case->key());
            $this->assertRestOutcome($response, $case);
            $this->assertTrue((bool) $this->shareRecord((string) $target['linkId'])['revoked'], $case->key().': own link still live.');

            return;
        }
        $response = $this->assertUnchanged(
            fn () => [$this->shareRecord((string) $target['linkId']), $this->shareRecord((string) $target['shareId'])],
            fn () => $send($target['folder']),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
        $this->assertSameAsUnknown($response, fn () => $send($this->unknownTwin($target['folder'])), $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runShareShow(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/files/shares/'.$target['shareId']);
        if ($case->outcome !== Outcome::Allowed) {
            // Neither the shared path nor the other grantees.
            $content = json_encode($response->json(), JSON_UNESCAPED_SLASHES);
            $this->assertStringNotContainsString($target['folder'], (string) $content, $case->key().': share path present.');
            $this->assertStringNotContainsString('"dave"', (string) $content, $case->key().': other grantee present.');
        }
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['shareId'], $response->json('data.id'), $case->key());
        }
    }

    /**
     * The actor tries to raise its own access to full.
     *
     * @param  array<string, mixed>  $target
     */
    private function runSharePatch(OwnershipCase $case, array $target): void
    {
        $self = $this->usernameFor($case->actor);
        $updatedAt = DriveShare::query()->find($target['shareId'])?->updated_at?->toISOString();
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/files/shares/'.$target['shareId'], [
            'updatedAt' => $updatedAt,
            'shareWith' => [$self => ['access' => 'full']],
        ]);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);

            return;
        }
        $response = $this->assertUnchanged(fn () => $this->shareRecord((string) $target['shareId']), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runShareDelete(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/files/shares/'.$target['shareId']);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $this->assertTrue((bool) $this->shareRecord((string) $target['shareId'])['revoked'], $case->key().': share still live.');

            return;
        }
        $response = $this->assertUnchanged(fn () => $this->shareRecord((string) $target['shareId']), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runInviteCreate(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/files/shares/'.$target['shareId'].'/invites', [
            'email' => 'outside@example.com',
            'access' => 'edit',
        ]);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);

            return;
        }
        $response = $this->assertUnchanged(fn () => $this->shareRecord((string) $target['shareId']), $send, $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertNull($response->json('data.inviteToken'), $case->key());
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runInviteDelete(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/files/shares/'.$target['shareId'].'/invites/'.$target['inviteId']);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);

            return;
        }
        $response = $this->assertUnchanged(fn () => $this->shareRecord((string) $target['shareId']), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    // ---- Runners: JMAP and blobs -----------------------------------------

    /**
     * @param  array<string, mixed>  $target
     */
    private function runDownload(OwnershipCase $case, array $target): void
    {
        $self = $this->usernameFor($case->actor);
        $accountId = $case->variant === 'foreign-account' ? OwnershipPrincipals::CAROL : $self;
        $blobId = $this->nodesOf($target)['blobId'];
        $expected = $target['body'];
        if ($case->variant === 'envelope-blob') {
            $expected = 'carol envelope blob';
            $blobId = (string) $this->call(
                'POST',
                '/api/v1/jmap/upload/carol',
                server: $this->transformHeadersToServerVars(['Authorization' => 'Bearer '.$this->mintUserToken(OwnershipPrincipals::CAROL, 'user'), 'Content-Type' => 'text/plain']),
                content: $expected,
            )->assertCreated()->json('blobId');
        }

        $response = $this->requestAs($case->actor, 'GET', '/jmap/download/'.$accountId.'/'.$blobId.'/file.md');
        if ($case->outcome === Outcome::Allowed) {
            $response->assertOk();
            $this->assertSame($expected, $this->bodyOf($response), $case->key());

            return;
        }
        $this->assertStringNotContainsString($expected, $this->bodyOf($response), $case->key());
        $this->assertBlobNotFound($response, $case);
    }

    private function assertBlobNotFound(TestResponse $response, OwnershipCase $case): void
    {
        $this->assertSame(404, $response->getStatusCode(), $case->key().' returned '.$response->getStatusCode().': '.substr((string) $response->getContent(), 0, 200));
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runNodeGet(OwnershipCase $case, array $target): void
    {
        $docId = $this->nodesOf($target)['docId'];
        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $this->usernameFor($case->actor);
        $response = $this->jmap($case->actor, [['FileNode/get', ['accountId' => $accountId, 'ids' => [$docId]], 'c0']]);
        $this->assertJmapGetOutcome($response, $docId, $case);
        if ($case->outcome !== Outcome::Allowed) {
            $this->assertStringNotContainsString($target['docName'], (string) $response->getContent(), $case->key());
        }
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runNodeQuery(OwnershipCase $case, array $target): void
    {
        $nodes = $this->nodesOf($target);
        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $this->usernameFor($case->actor);
        $response = $this->jmap($case->actor, [['FileNode/query', ['accountId' => $accountId, 'filter' => ['parentId' => $nodes['folderId']]], 'c0']]);
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }
        $response->assertOk();
        $ids = array_map('strval', (array) $response->json('methodResponses.0.1.ids'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($nodes['docId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$nodes['docId']], $ids, $case->key());
        $unfiltered = $this->jmap($case->actor, [['FileNode/query', ['accountId' => $accountId], 'c0']]);
        $this->assertIdsAbsent([$nodes['docId']], array_map('strval', (array) $unfiltered->json('methodResponses.0.1.ids')), $case->key().' (unfiltered)');
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function runNodeSet(OwnershipCase $case, array $target): void
    {
        $self = $this->usernameFor($case->actor);
        $nodes = $this->nodesOf($target);
        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $self;
        $variant = (string) $case->variant;

        [$args, $operation, $id] = match (true) {
            str_starts_with($variant, 'content') => (function () use ($case, $self, $nodes): array {
                $blobId = (string) $this->uploadBlob($case->actor, $self, "# replaced by actor\n")->assertCreated()->json('blobId');

                return [['update' => [$nodes['docId'] => ['blobId' => $blobId]]], 'update', $nodes['docId']];
            })(),
            str_starts_with($variant, 'rename') => [['update' => [$nodes['docId'] => ['name' => 'renamed-by-actor.md']]], 'update', $nodes['docId']],
            str_starts_with($variant, 'create-child') => [['create' => ['k1' => ['parentId' => $nodes['folderId'], 'name' => 'made-by-actor', 'nodeType' => 'directory']]], 'create', 'k1'],
            $variant === 'move-into' => $this->moveIntoArgs($case, $nodes),
            default => [['destroy' => [$nodes['docId']]], 'destroy', $nodes['docId']],
        };
        $send = fn (): TestResponse => $this->jmap($case->actor, [['FileNode/set', ['accountId' => $accountId, ...$args], 'c0']]);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertJmapSetOutcome($send(), $operation, $id, $case);

            return;
        }
        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertJmapSetOutcome($response, $operation, $id, $case);
    }

    /**
     * The actor's own document, moved into the scope's folder.
     *
     * @param  array{docId: string, folderId: string, blobId: string}  $nodes
     * @return array{0: array<string, mixed>, 1: string, 2: string}
     */
    private function moveIntoArgs(OwnershipCase $case, array $nodes): array
    {
        $self = $this->usernameFor($case->actor);
        $ownName = 'own-for-move.md';
        app(WgwStorage::class)->files()->put('users/'.$self.'/'.$ownName, "own\n");
        $own = $this->nodesOf(['owner' => $self, 'docName' => $ownName]);

        return [['update' => [$own['docId'] => ['parentId' => $nodes['folderId']]]], 'update', $own['docId']];
    }

    // ---- Runners: download tickets ---------------------------------------

    /**
     * Mints a ticket for the scope's document, by path or by blobId, and
     * redeems it on the public ticket URL without a token.
     */
    private function runTicket(OwnershipCase $case): void
    {
        // Tickets need a session-bound token, issued before any former-group removal.
        $token = $this->sessionTokenFor($case->actor);
        $target = $this->seedTarget($case);
        $expected = $target['body'];
        if ($case->operation === 'POST /files/download-tickets') {
            $uri = '/files/download-tickets';
            $payload = ['path' => $this->pathFor($case, $target, true)];
        } else {
            $self = $this->usernameFor($case->actor);
            $blobId = $this->nodesOf($target)['blobId'];
            if ($case->variant === 'envelope-blob') {
                $expected = 'carol envelope blob '.uniqid();
                $blobId = $this->uploadAsUsername(OwnershipPrincipals::CAROL, $expected);
            }
            $uri = '/jmap/download-tickets/'.($case->variant === 'foreign-account' ? OwnershipPrincipals::CAROL : $self);
            $payload = ['blobId' => $blobId, 'name' => 'file.md'];
        }
        $send = fn (): TestResponse => $this->json('POST', '/api/v1'.$uri, $payload, $this->bearerHeaders($token));

        if ($case->variant === 'after-issue') {
            $path = $this->ticketPath($send()->assertCreated());
            $this->assertSame($expected, $this->bodyOf($this->call('GET', $path)->assertOk()), $case->key().': ticket did not serve before.');
            $this->endScopeAccess($case, $target);
            $redeemed = $this->call('GET', $path);
            $this->assertSame(404, $redeemed->getStatusCode(), $case->key().': ticket still serves after access ended.');
            $this->assertStringNotContainsString($expected, $this->bodyOf($redeemed), $case->key());

            return;
        }

        if ($case->outcome === Outcome::Allowed) {
            $response = $send();
            $this->assertRestOutcome($response, $case);
            $path = $this->ticketPath($response);
            $carolBody = "carol body behind another name\n";
            if ($case->variant === 'other-name') {
                app(WgwStorage::class)->files()->put('users/carol/box/carol-doc.md', $carolBody);
                $path = substr($path, 0, (int) strrpos($path, '/') + 1).'carol-doc.md';
            }
            $download = $this->call('GET', $path);
            $download->assertOk();
            $body = $this->bodyOf($download);
            $this->assertSame($expected, $body, $case->key());
            $this->assertStringNotContainsString($carolBody, $body, $case->key());

            return;
        }

        $response = $this->assertUnchanged(fn (): int => JmapDownloadTicket::query()->count(), $send, $case->key());
        $this->assertNull($response->json('url'), $case->key().': denied response carries a ticket URL.');
        $this->assertStringNotContainsString($expected, (string) $response->getContent(), $case->key());
        $this->assertTargetHidden($response, $target, $case);
        $this->assertRestOutcome($response, $case);
    }

    private function ticketPath(TestResponse $response): string
    {
        $url = $response->json('url');
        $this->assertIsString($url, 'No ticket URL: '.substr((string) $response->getContent(), 0, 200));

        return (string) parse_url($url, PHP_URL_PATH);
    }

    /**
     * A user token bound to a live sign-in session (`sid`), as tickets require.
     */
    private function sessionTokenFor(Actor $actor): string
    {
        $username = $this->usernameFor($actor);
        $role = $actor === Actor::Admin ? 'admin' : 'user';
        $refreshTokens = app(RefreshTokenRepository::class);
        $sid = (string) $refreshTokens->familyIdFor($refreshTokens->issue($username, $role));

        return app(JwtTokenService::class)->issue([
            'sub' => $username,
            'role' => $role,
            'exp' => time() + 3600,
            'uid' => (int) User::query()->where('username', $username)->value('id'),
            'sid' => $sid,
        ]);
    }

    // ---- Runners: Blob methods and assemblies ----------------------------

    private function uploadAsUsername(string $username, string $contents): string
    {
        $token = match ($username) {
            OwnershipPrincipals::MEMBER => $this->tokenFor(Actor::Member),
            OwnershipPrincipals::ADMIN => $this->tokenFor(Actor::Admin),
            default => $this->mintUserToken($username, 'user'),
        };

        return (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/'.$username,
            server: $this->transformHeadersToServerVars(['Authorization' => 'Bearer '.$token, 'Content-Type' => 'text/plain']),
            content: $contents,
        )->assertCreated()->json('blobId');
    }

    /**
     * @return list<string>
     */
    private function blobIdsOf(string $username): array
    {
        return array_map('strval', JmapBlob::query()->where('username', $username)->orderBy('blob_id')->pluck('blob_id')->all());
    }

    /**
     * The source blob of the case: the actor's own upload, carol's upload,
     * or (`file-blob`) carol's drive file.
     */
    private function sourceBlob(OwnershipCase $case): string
    {
        if ($case->variant === 'file-blob') {
            return $this->nodesOf($this->seedTarget($case))['blobId'];
        }
        $owner = $case->scope === Scope::OwnUser ? $this->usernameFor($case->actor) : OwnershipPrincipals::CAROL;

        return $this->uploadAsUsername($owner, 'blob of '.$owner.' '.uniqid());
    }

    private function runBlob(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $carol = OwnershipPrincipals::CAROL;
        $foreign = $case->outcome === Outcome::AccountNotFound;
        $accountId = $foreign ? $carol : $self;
        $using = [JmapCapabilities::CORE, JmapCapabilities::BLOB];

        if ($case->operation === 'JMAP Blob/get') {
            $blobId = $this->sourceBlob($case);
            $response = $this->jmapAs($case->actor, [['Blob/get', ['accountId' => $accountId, 'ids' => [$blobId], 'properties' => ['id', 'size']], 'c0']], $using);
            $this->assertJmapGetOutcome($response, $blobId, $case);

            return;
        }

        if ($foreign) {
            // Had the join landed in carol's account, she would hold this content-addressed id.
            $response = $this->assertUnchanged(
                fn (): array => $this->blobIdsOf($carol),
                fn (): TestResponse => $this->jmapAs($case->actor, [['Blob/upload', ['accountId' => $carol, 'create' => [
                    'k1' => ['data' => [['data:asText' => 'joined by '.$self.' '.uniqid()]]],
                ]], 'c0']], $using),
                $case->key(),
            );
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }

        $source = $this->sourceBlob($case);
        $send = fn (): TestResponse => $this->jmapAs($case->actor, [['Blob/upload', ['accountId' => $self, 'create' => [
            'k1' => ['data' => [['blobId' => $source]], 'type' => 'text/plain'],
        ]], 'c0']], $using);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertJmapSetOutcome($send(), 'create', 'k1', $case);

            return;
        }
        // The joined blob would carry carol's content-addressed id in the actor's account.
        $response = $this->assertUnchanged(fn (): array => $this->blobIdsOf($self), $send, $case->key());
        $this->assertCaseOutcome($case, function (OwnershipCase $case) use ($response, $source): void {
            $error = (array) $response->assertOk()->json('methodResponses.0.1.notCreated.k1');
            $this->assertSame($case->errorCode ?? 'notFound', $error['type'] ?? null, $case->key().': '.json_encode($error));
            $this->assertContains($source, (array) ($error['notFound'] ?? []), $case->key());
        });
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function assemblyCall(string $username, array $calls): TestResponse
    {
        return $this->requestAsUsername($username, 'POST', '/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::BLOB_ASSEMBLY],
            'methodCalls' => $calls,
        ]);
    }

    /**
     * An open assembly of $username, holding $contents in one part when $filled.
     */
    private function seedAssembly(string $username, string $contents, bool $filled): string
    {
        $id = (string) $this->assemblyCall($username, [['BlobAssembly/set', ['accountId' => $username, 'create' => [
            'a' => ['size' => strlen($contents), 'type' => 'text/plain'],
        ]], 'c0']])->assertOk()->json('methodResponses.0.1.created.a.id');
        if ($filled) {
            $part = $this->uploadAsUsername($username, $contents);
            $accepted = $this->assemblyCall($username, [['BlobAssembly/append', ['accountId' => $username, 'id' => $id, 'parts' => [
                ['index' => 0, 'blobId' => $part],
            ]], 'c0']])->assertOk()->json('methodResponses.0.1.accepted');
            $this->assertSame([0], $accepted, 'Seeding the assembly of '.$username.' failed.');
        }

        return $id;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function assemblyRecord(string $id): ?array
    {
        return JmapBlobAssembly::query()->where('assembly_id', $id)->first()?->toArray();
    }

    private function runAssembly(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $carol = OwnershipPrincipals::CAROL;
        $accountId = $case->outcome === Outcome::AccountNotFound ? $carol : $self;
        $method = substr($case->operation, strlen('JMAP '));
        $contents = 'assembled bytes '.uniqid();
        $owner = $case->scope === Scope::OwnUser || $case->variant === 'part' ? $self : $carol;
        $send = fn (string $id, array $args = []): TestResponse => $this->assemblyCall($self, [[$method, ['accountId' => $accountId, ...$args, 'id' => $id], 'c0']]);

        if ($case->variant === 'create') {
            $response = $this->assemblyCall($self, [[$method, ['accountId' => $self, 'create' => ['k1' => ['size' => 4]]], 'c0']]);
            $this->assertJmapSetOutcome($response, 'create', 'k1', $case);
            $this->assertNotNull($this->assemblyRecord((string) $response->json('methodResponses.0.1.created.k1.id')), $case->key());

            return;
        }

        $id = $this->seedAssembly($owner, $contents, $method === 'BlobAssembly/finish');

        if ($method === 'BlobAssembly/set' || $method === 'BlobAssembly/get') {
            $args = $method === 'BlobAssembly/set' ? ['destroy' => [$id]] : ['ids' => [$id]];
            $call = fn (): TestResponse => $this->assemblyCall($self, [[$method, ['accountId' => $accountId, ...$args], 'c0']]);
            if ($method === 'BlobAssembly/get') {
                $this->assertJmapGetOutcome($call(), $id, $case);
                if ($case->outcome === Outcome::NotFound) {
                    $all = $this->assemblyCall($self, [[$method, ['accountId' => $self, 'ids' => null], 'c0']])->assertOk();
                    $this->assertIdsAbsent([$id], array_map('strval', array_column((array) $all->json('methodResponses.0.1.list'), 'id')), $case->key().' (all)');
                }

                return;
            }
            if ($case->outcome === Outcome::Allowed) {
                $this->assertJmapSetOutcome($call(), 'destroy', $id, $case);
                $this->assertNull($this->assemblyRecord($id), $case->key().': assembly still stored.');

                return;
            }
            $response = $this->assertUnchanged(fn (): ?array => $this->assemblyRecord($id), $call, $case->key());
            $this->assertJmapSetOutcome($response, 'destroy', $id, $case);

            return;
        }

        $args = [];
        if ($method === 'BlobAssembly/append') {
            $part = $this->uploadAsUsername($case->variant === 'part' ? $carol : $self, $contents);
            $args = ['parts' => [['index' => 0, 'blobId' => $part]]];
        }
        if ($case->outcome === Outcome::Allowed) {
            $response = $send($id, $args)->assertOk();
            $this->assertSame($method, $response->json('methodResponses.0.0'), $case->key().': '.json_encode($response->json('methodResponses.0')));
            if ($method === 'BlobAssembly/append') {
                $this->assertSame([0], $response->json('methodResponses.0.1.accepted'), $case->key());
            } else {
                $this->assertStringStartsWith('jb-', (string) $response->json('methodResponses.0.1.blobId'), $case->key());
            }

            return;
        }

        $response = $this->assertUnchanged(
            fn (): array => [$this->assemblyRecord($id), $this->blobIdsOf($self), $this->blobIdsOf($carol)],
            fn (): TestResponse => $send($id, $args),
            $case->key(),
        );
        $this->assertCaseOutcome($case, function (OwnershipCase $case) use ($response, $send, $args): void {
            if ($case->outcome === Outcome::AccountNotFound) {
                $this->assertJmapMethodError($response, 'accountNotFound', $case);

                return;
            }
            if ($case->errorCode !== null) {
                $this->assertJmapMethodError($response, $case->errorCode, $case);
                $this->assertContains($args['parts'][0]['blobId'] ?? null, (array) $response->json('methodResponses.0.1.notFound'), $case->key());

                return;
            }
            // Another account's assembly answers exactly like an unknown id
            // (the 1500 spec gives unknown assemblies `invalidArguments`).
            $this->assertJmapMethodError($response, 'invalidArguments', $case);
            $unknown = $send(self::UNKNOWN_ASSEMBLY, $args);
            $this->assertSame($unknown->json('methodResponses.0'), $response->json('methodResponses.0'), $case->key().': existing and unknown assemblies differ.');
        });
    }
}
