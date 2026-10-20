<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\WgwInstallConfig;

/**
 * Picks a data directory outside the published tree when the parent of the
 * install is writable, and refuses to share that directory with another install.
 *
 * The shipped default `WGW_DATA_DIR=./wgw-content` in `.env.example` is not an
 * operator choice. Honouring it would keep every ZIP install inside the web root.
 * Any other value is returned unchanged.
 */
final class DataDirCandidateResolver
{
    public const MARKER = '.wgw-owner';

    public function __construct(private WgwInstallConfig $install) {}

    public function propose(?string $documentRoot = null): DataDirChoice
    {
        $explicit = $this->explicitDataDir();
        if ($explicit !== null) {
            return new DataDirChoice(
                $explicit,
                DataDirChoice::REASON_ENVIRONMENT,
                $this->isInsidePublishedTree($explicit, $documentRoot),
            );
        }

        $installRoot = $this->installRoot();
        $owner = $this->ownerId($installRoot);
        $boundary = $this->boundary($documentRoot, $installRoot);
        $owned = false;

        foreach ($this->candidates($installRoot, $documentRoot) as $candidate) {
            $claimed = $this->evaluate($candidate, $owner, $boundary);
            if (is_string($claimed)) {
                return new DataDirChoice($claimed, DataDirChoice::REASON_OUTSIDE, false);
            }
            if ($claimed['failure'] === 'owned') {
                $owned = true;
            }
        }

        return new DataDirChoice(
            DataDirChoice::FALLBACK_PATH,
            $owned ? DataDirChoice::REASON_FALLBACK_OWNED : DataDirChoice::REASON_FALLBACK_UNAVAILABLE,
            true,
        );
    }

    public function accept(?string $override, ?string $documentRoot = null): DataDirChoice
    {
        $override = trim((string) $override);
        if ($override === '') {
            return $this->propose($documentRoot);
        }

        $proposal = $this->propose($documentRoot);
        if ($this->samePath($override, $proposal->path)) {
            return $proposal;
        }

        $chosen = $this->validateOverride($override, $documentRoot);
        $this->releaseUnusedReservation($proposal, $chosen);

        return $chosen;
    }

    public function isInsidePublishedTree(string $dataDir, ?string $documentRoot = null): bool
    {
        return $this->isInside(
            $this->resolveDataDir($dataDir),
            $this->boundary($documentRoot, $this->installRoot()),
        );
    }

    public function configuredDirectoryIsPublished(): bool
    {
        $configured = config('wgw.data_dir');
        $path = is_string($configured) && trim($configured) !== '' ? trim($configured) : DataDirChoice::FALLBACK_PATH;

        return $this->isInsidePublishedTree($path, $this->serverDocumentRoot());
    }

    public function serverDocumentRoot(): ?string
    {
        $root = $_SERVER['DOCUMENT_ROOT'] ?? null;

        return is_string($root) && $root !== '' ? $root : null;
    }

    public function validateOverride(string $path, ?string $documentRoot = null): DataDirChoice
    {
        $path = $this->normalize($path);
        if (! $this->isAbsolute($path)) {
            throw new \RuntimeException('Enter an absolute path for the data directory.');
        }

        $parentReal = realpath(dirname($path));
        if ($parentReal === false) {
            throw new \RuntimeException('The parent of that data directory does not exist.');
        }

        $candidate = $this->normalize($parentReal).'/'.basename($path);
        if ($this->isInside($candidate, $this->boundary($documentRoot, $this->installRoot()))) {
            throw new \RuntimeException('That directory is inside the published website. Choose a folder outside it.');
        }

        if (! $this->parentAcceptsWrites($parentReal)) {
            throw new \RuntimeException('That directory is not writable by the web server.');
        }

        $failure = $this->claim($candidate, $this->ownerId($this->installRoot()));
        if ($failure === 'owned') {
            throw new \RuntimeException('That directory belongs to another installation.');
        }
        if ($failure !== null) {
            throw new \RuntimeException('That directory is not writable by the web server.');
        }

        return new DataDirChoice($candidate, DataDirChoice::REASON_OUTSIDE, false);
    }

    /**
     * Point a stock SQLite path at the chosen data directory.
     * A path the operator already set is left alone.
     *
     * @param  array<string, mixed>  $db
     * @return array<string, mixed>
     */
    public function placeSqliteDatabase(array $db, string $dataDir): array
    {
        if (($db['driver'] ?? '') !== 'sqlite') {
            return $db;
        }

        $path = str_replace('\\', '/', trim((string) ($db['sqlite_path'] ?? '')));
        if (! in_array($path, ['', './wgw-content/db.sqlite', 'wgw-content/db.sqlite'], true)) {
            return $db;
        }

        $db['sqlite_path'] = rtrim($this->normalize($dataDir), '/').'/db.sqlite';

        return $db;
    }

    public function apply(DataDirChoice $choice): void
    {
        $path = $choice->path;
        putenv('WGW_DATA_DIR='.$path);
        $_ENV['WGW_DATA_DIR'] = $path;
        $_SERVER['WGW_DATA_DIR'] = $path;
        config(['wgw.data_dir' => $path]);
    }

    /**
     * `.env.example` ships this value. It is the old default, not an operator override.
     */
    private function explicitDataDir(): ?string
    {
        $value = getenv('WGW_DATA_DIR');
        if (! is_string($value) || trim($value) === '') {
            $fromEnv = $_ENV['WGW_DATA_DIR'] ?? null;
            $value = is_string($fromEnv) ? $fromEnv : null;
        }
        if (! is_string($value) || trim($value) === '') {
            $fromServer = $_SERVER['WGW_DATA_DIR'] ?? null;
            $value = is_string($fromServer) ? $fromServer : null;
        }
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);
        if ($value === '' || $value === './wgw-content' || $value === 'wgw-content') {
            return null;
        }

        return $value;
    }

    /**
     * Plain `wgw-content` first, then a name that belongs to this install.
     * An abandoned reservation of the plain name must not push the next
     * install back inside the published tree.
     *
     * @return list<string>
     */
    private function candidates(string $installRoot, ?string $documentRoot): array
    {
        $parents = [$this->normalize(dirname($installRoot))];
        if (is_string($documentRoot) && $documentRoot !== '') {
            $docReal = realpath($documentRoot);
            $installReal = realpath($installRoot);
            if ($docReal !== false && ($installReal === false || $this->normalize($docReal) !== $this->normalize($installReal))) {
                $parents[] = $this->normalize(dirname($this->normalize($docReal)));
            }
        }

        $suffix = substr(hash('sha256', $this->ownerId($installRoot)), 0, 8);
        $candidates = [];
        foreach (array_values(array_unique($parents)) as $parent) {
            $candidates[] = $parent.'/wgw-content';
            $candidates[] = $parent.'/wgw-content-'.$suffix;
        }

        return array_values(array_unique($candidates));
    }

    /**
     * @return string|array{failure: 'owned'|'unavailable'} claimed path, or why it failed
     */
    private function evaluate(string $candidate, string $owner, string $boundary): string|array
    {
        $parentReal = realpath(dirname($candidate));
        if ($parentReal === false) {
            return ['failure' => 'unavailable'];
        }

        $candidateReal = $this->normalize($parentReal).'/'.basename($candidate);
        if ($this->isInside($candidateReal, $boundary)) {
            return ['failure' => 'unavailable'];
        }
        if (! $this->parentAcceptsWrites($parentReal)) {
            return ['failure' => 'unavailable'];
        }

        $failure = $this->claim($candidateReal, $owner);

        return $failure === null ? $candidateReal : ['failure' => $failure];
    }

    /**
     * @return 'owned'|'unavailable'|null
     */
    private function claim(string $candidate, string $owner): ?string
    {
        if (! is_dir($candidate) && ! @mkdir($candidate, 0775) && ! is_dir($candidate)) {
            return 'unavailable';
        }

        $entries = $this->entries($candidate);
        if ($entries === null) {
            return 'unavailable';
        }
        if ($entries === []) {
            return $this->writeMarker($candidate, $owner) ? null : 'unavailable';
        }
        if (! in_array(self::MARKER, $entries, true)) {
            return 'owned';
        }
        if (! $this->markerMatches($candidate, $owner)) {
            return 'owned';
        }

        if ($entries === [self::MARKER]) {
            return $this->writeMarker($candidate, $owner) ? null : 'unavailable';
        }

        return null;
    }

    private function parentAcceptsWrites(string $parent): bool
    {
        return is_writable($parent) && $this->probe($parent);
    }

    private function probe(string $directory): bool
    {
        $probe = $this->normalize($directory).'/.wgw-data-probe-'.bin2hex(random_bytes(8));
        if (@file_put_contents($probe, "ok\n") === false) {
            return false;
        }
        @unlink($probe);

        return true;
    }

    private function writeMarker(string $candidate, string $owner): bool
    {
        return file_put_contents($candidate.'/'.self::MARKER, $owner."\n", LOCK_EX) !== false;
    }

    private function markerMatches(string $candidate, string $owner): bool
    {
        $contents = @file_get_contents($candidate.'/'.self::MARKER);
        if (! is_string($contents) || trim($contents) === '') {
            return false;
        }

        return $this->samePath(trim($contents), $owner);
    }

    private function releaseUnusedReservation(DataDirChoice $proposal, DataDirChoice $chosen): void
    {
        if ($proposal->reason !== DataDirChoice::REASON_OUTSIDE || $this->samePath($proposal->path, $chosen->path)) {
            return;
        }
        if (! is_dir($proposal->path)) {
            return;
        }

        $entries = $this->entries($proposal->path);
        if ($entries !== [self::MARKER] || ! $this->markerMatches($proposal->path, $this->ownerId($this->installRoot()))) {
            return;
        }

        @unlink($proposal->path.'/'.self::MARKER);
        @rmdir($proposal->path);
    }

    /**
     * @return list<string>|null
     */
    private function entries(string $directory): ?array
    {
        $items = scandir($directory);
        if ($items === false) {
            return null;
        }

        $entries = [];
        foreach ($items as $item) {
            if ($item !== '.' && $item !== '..') {
                $entries[] = $item;
            }
        }
        sort($entries);

        return $entries;
    }

    private function boundary(?string $documentRoot, string $installRoot): string
    {
        if (is_string($documentRoot) && $documentRoot !== '') {
            $real = realpath($documentRoot);
            if ($real !== false) {
                return $this->normalize($real);
            }
        }

        $realInstall = realpath($installRoot);

        return $this->normalize($realInstall !== false ? $realInstall : $installRoot);
    }

    /**
     * The absolute folder a data directory setting points at. A relative
     * setting is resolved against the install root, as the runtime does.
     */
    public function absolutePath(string $dataDir): string
    {
        return $this->resolveDataDir($dataDir);
    }

    private function resolveDataDir(string $dataDir): string
    {
        $dataDir = $this->normalize(trim($dataDir));
        if ($dataDir === '' || $dataDir === '.') {
            $dataDir = $this->normalize($this->installRoot()).'/wgw-content';
        } elseif (! $this->isAbsolute($dataDir)) {
            $relative = $dataDir;
            while (str_starts_with($relative, './')) {
                $relative = substr($relative, 2);
            }
            $dataDir = $this->normalize($this->installRoot()).'/'.ltrim($relative, '/');
        }

        $real = realpath($dataDir);
        if ($real !== false) {
            return $this->normalize($real);
        }

        // Not created yet: resolve the parent so a symlinked root still matches.
        $parentReal = realpath(dirname($dataDir));

        return $parentReal !== false
            ? $this->normalize($parentReal).'/'.basename($dataDir)
            : $this->normalize($dataDir);
    }

    private function installRoot(): string
    {
        return $this->normalize($this->install->installRoot());
    }

    private function ownerId(string $installRoot): string
    {
        $real = realpath($installRoot);

        return $this->normalize($real !== false ? $real : $installRoot);
    }

    private function samePath(string $left, string $right): bool
    {
        if ($this->normalize($left) === $this->normalize($right)) {
            return true;
        }

        return $this->resolveDataDir($left) === $this->resolveDataDir($right);
    }

    private function isInside(string $path, string $root): bool
    {
        $path = $this->normalize($path);
        $root = $this->normalize($root);

        return $path === $root || str_starts_with($path, $root.'/');
    }

    private function isAbsolute(string $path): bool
    {
        if ($path !== '' && $path[0] === '/') {
            return true;
        }

        return \PHP_OS_FAMILY === 'Windows'
            && strlen($path) > 2
            && ctype_alpha($path[0])
            && $path[1] === ':';
    }

    private function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}
