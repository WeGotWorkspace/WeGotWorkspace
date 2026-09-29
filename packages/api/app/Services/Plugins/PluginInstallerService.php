<?php

declare(strict_types=1);

namespace App\Services\Plugins;

use App\Models\AppSetting;
use App\Support\AppPaths;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;

final class PluginInstallerService
{
    private const ACTIVE_OVERRIDES_SETTING = 'plugins_active_overrides';

    private const MAX_PLUGIN_ARCHIVE_BYTES = 512 * 1024 * 1024;

    public function __construct(
        private AppPaths $paths,
        private PluginRegistryService $registry,
    ) {}

    /**
     * @return array{
     *   ok: true,
     *   plugin: array<string, mixed>,
     *   plugins: list<array<string, mixed>>
     * }
     */
    public function installFromZip(UploadedFile $archive): array
    {
        if (strtolower((string) $archive->getClientOriginalExtension()) !== 'zip') {
            throw new \InvalidArgumentException('Plugin archive must be a .zip file.');
        }
        $archiveSize = $archive->getSize();
        if (is_int($archiveSize) && $archiveSize > self::MAX_PLUGIN_ARCHIVE_BYTES) {
            throw new \InvalidArgumentException('Plugin archive is too large.');
        }

        $tmpRoot = rtrim((string) storage_path('framework/cache'), '/').'/plugin-install-'.uniqid('', true);
        File::ensureDirectoryExists($tmpRoot);

        $zip = new \ZipArchive;
        $opened = $zip->open($archive->getRealPath());
        if ($opened !== true) {
            throw new \InvalidArgumentException('Invalid plugin ZIP archive.');
        }
        $this->assertSafeZipEntries($zip);
        $zip->extractTo($tmpRoot);
        $zip->close();

        $manifestPath = $this->findPluginManifest($tmpRoot);
        if ($manifestPath === null) {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('plugin.json not found in ZIP.');
        }

        if (! File::isReadable($manifestPath)) {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('plugin.json is not readable.');
        }
        $manifestRaw = File::get($manifestPath);
        try {
            $manifest = json_decode($manifestRaw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('plugin.json is not valid JSON.');
        }
        if (! is_array($manifest)) {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('plugin.json is not a JSON object.');
        }
        $pluginId = isset($manifest['id']) && is_string($manifest['id']) ? trim($manifest['id']) : '';
        if ($pluginId === '') {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('plugin.json must contain a non-empty "id".');
        }

        $sourceDir = dirname($manifestPath);
        $assetsIndex = $sourceDir.'/assets/index.html';
        if (! is_readable($assetsIndex)) {
            File::deleteDirectory($tmpRoot);
            throw new \InvalidArgumentException('Plugin assets/index.html is missing.');
        }

        $pluginsRoot = $this->paths->pluginsRoot();
        File::ensureDirectoryExists($pluginsRoot);

        $destination = $pluginsRoot.'/'.$pluginId;
        $staging = $pluginsRoot.'/.install-'.$pluginId.'-'.uniqid('', true);
        $backup = $pluginsRoot.'/.backup-'.$pluginId.'-'.uniqid('', true);
        $hadExisting = is_dir($destination);

        if (! File::copyDirectory($sourceDir, $staging)) {
            File::deleteDirectory($tmpRoot);
            throw new \RuntimeException('Could not stage plugin files.');
        }

        try {
            if ($hadExisting && ! File::moveDirectory($destination, $backup)) {
                throw new \RuntimeException('Could not back up current plugin.');
            }
            if (! File::moveDirectory($staging, $destination)) {
                throw new \RuntimeException('Could not install plugin files.');
            }
        } catch (\Throwable $e) {
            if (is_dir($destination)) {
                File::deleteDirectory($destination);
            }
            if ($hadExisting && is_dir($backup)) {
                File::moveDirectory($backup, $destination);
            }
            if (is_dir($staging)) {
                File::deleteDirectory($staging);
            }
            File::deleteDirectory($tmpRoot);
            throw $e;
        }

        if (is_dir($backup)) {
            File::deleteDirectory($backup);
        }
        File::deleteDirectory($tmpRoot);

        $this->markActive($pluginId, true);

        $plugins = $this->registry->list();
        $plugin = null;
        foreach ($plugins as $candidate) {
            if ($candidate['id'] === $pluginId) {
                $plugin = $candidate;
                break;
            }
        }
        if ($plugin === null) {
            throw new \RuntimeException('Plugin installed but registry entry was not found.');
        }

        return [
            'ok' => true,
            'plugin' => $plugin,
            'plugins' => $plugins,
        ];
    }

    private function markActive(string $pluginId, bool $active): void
    {
        $value = AppSetting::getValue(self::ACTIVE_OVERRIDES_SETTING, []);
        $overrides = is_array($value) ? $value : [];
        $overrides[$pluginId] = $active;
        AppSetting::setValue(self::ACTIVE_OVERRIDES_SETTING, $overrides);
    }

    private function findPluginManifest(string $root): ?string
    {
        $candidates = File::allFiles($root);
        foreach ($candidates as $candidate) {
            if ($candidate->getFilename() === 'plugin.json') {
                return $candidate->getPathname();
            }
        }

        return null;
    }

    private function assertSafeZipEntries(\ZipArchive $zip): void
    {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = (string) $zip->getNameIndex($i);
            if ($entry === '') {
                throw new \InvalidArgumentException('ZIP contains an invalid entry.');
            }

            $normalized = str_replace('\\', '/', $entry);
            if (
                str_starts_with($normalized, '/')
                || str_contains($normalized, '../')
                || str_contains($normalized, '/..')
                || preg_match('/^[a-zA-Z]:\//', $normalized) === 1
            ) {
                throw new \InvalidArgumentException('ZIP contains unsafe path traversal entries.');
            }
        }
    }
}
