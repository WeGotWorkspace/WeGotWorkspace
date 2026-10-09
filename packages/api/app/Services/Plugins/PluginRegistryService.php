<?php

declare(strict_types=1);

namespace App\Services\Plugins;

use App\Models\AppSetting;
use App\Services\Installer\InstallerWebBase;
use App\Support\SafePath;
use Illuminate\Support\Facades\File;

final class PluginRegistryService
{
    private const ACTIVE_OVERRIDES_SETTING = 'plugins_active_overrides';

    public function __construct(
        private PluginPaths $pluginPaths,
    ) {}

    /**
     * @return list<array{
     *   id: string,
     *   name: string,
     *   active: bool,
     *   source: string,
     *   appTile?: array{id: string, label: string, route: string, icon?: string},
     *   drive?: array{
     *     openFileExtensions?: list<string>,
     *     openFileRoute?: string,
     *     openFileQueryParam?: string,
     *     newFileTemplates?: list<array{
     *       id: string,
     *       label: string,
     *       kind: string,
     *       queryValue: string
     *     }>
     *   },
     *   integration?: array{
     *     configGlobal?: string,
     *     sessionApiPath?: string,
     *     saveTransport?: string,
     *     editorPaths?: list<string>
     *   },
     *   runtime?: array{indexReady: bool, editorReady: bool}
     * }>
     */
    public function list(): array
    {
        if (! config('wgw.plugins.enabled')) {
            return [];
        }

        $pluginsById = [];
        foreach ($this->loadInstalledPlugins() as $plugin) {
            $pluginsById[$plugin['id']] = $plugin;
        }

        $plugins = array_values($pluginsById);
        $overrides = $this->activeOverrides();
        foreach ($plugins as &$plugin) {
            $id = (string) $plugin['id'];
            if ($id !== '' && array_key_exists($id, $overrides)) {
                $plugin['active'] = (bool) $overrides[$id];
            }
            $plugin['runtime'] = $this->runtimeForPlugin($plugin);
        }
        unset($plugin);

        return $plugins;
    }

    /**
     * @return array{
     *   plugin: array{
     *     id: string,
     *     name: string,
     *     active: bool,
     *     source: string
     *   },
     *   plugins: list<array{
     *     id: string,
     *     name: string,
     *     active: bool,
     *     source: string
     *   }>
     * }|null
     */
    public function setActive(string $id, bool $active): ?array
    {
        $id = trim($id);
        if ($id === '') {
            return null;
        }

        $existing = $this->list();
        $knownIds = array_map(
            static fn (array $plugin): string => (string) $plugin['id'],
            $existing,
        );
        if (! in_array($id, $knownIds, true)) {
            return null;
        }

        $overrides = $this->activeOverrides();
        $overrides[$id] = $active;
        AppSetting::setValue(self::ACTIVE_OVERRIDES_SETTING, $overrides);

        $plugins = $this->list();
        foreach ($plugins as $plugin) {
            if ((string) $plugin['id'] === $id) {
                return [
                    'plugin' => $plugin,
                    'plugins' => $plugins,
                ];
            }
        }

        return null;
    }

    public function routeAssetIndex(string $route): ?string
    {
        $route = $this->normalizeRoute($route);
        if ($route === '') {
            return null;
        }

        foreach ($this->list() as $plugin) {
            if (! $plugin['active']) {
                continue;
            }
            $pluginRoute = isset($plugin['appTile']['route'])
                ? $this->normalizeRoute($plugin['appTile']['route'])
                : '';
            if ($pluginRoute !== $route) {
                continue;
            }

            $index = $this->assetIndexPath((string) $plugin['id']);
            if ($index !== null) {
                return $index;
            }
        }

        return null;
    }

    public function routeEditorReady(string $route): bool
    {
        $route = $this->normalizeRoute($route);
        if ($route === '') {
            return false;
        }

        foreach ($this->list() as $plugin) {
            if (! $plugin['active']) {
                continue;
            }
            $pluginRoute = isset($plugin['appTile']['route'])
                ? $this->normalizeRoute($plugin['appTile']['route'])
                : '';
            if ($pluginRoute !== $route) {
                continue;
            }

            $manifest = $this->manifestPathForPlugin((string) $plugin['id']);
            if ($manifest !== null && $this->pluginPaths->editorReadyForManifest($manifest)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{
     *   plugin: array<string, mixed>,
     *   routePrefix: string,
     *   indexPath: string|null,
     *   buildRoot: string|null
     * }|null
     */
    public function findActiveByRequestPath(string $webBase, string $path): ?array
    {
        foreach ($this->list() as $plugin) {
            if (! $plugin['active']) {
                continue;
            }
            if (! isset($plugin['appTile']['route'])) {
                continue;
            }
            $route = trim($plugin['appTile']['route']);
            if ($route === '') {
                continue;
            }
            $routePrefix = InstallerWebBase::url($webBase, $route);
            if ($path !== $routePrefix && ! str_starts_with($path, $routePrefix.'/')) {
                continue;
            }

            $indexPath = $this->assetIndexPath((string) $plugin['id']);

            return [
                'plugin' => $plugin,
                'routePrefix' => $routePrefix,
                'indexPath' => $indexPath,
                'buildRoot' => $indexPath !== null ? dirname($indexPath) : null,
            ];
        }

        return null;
    }

    public function assetIndexPath(string $pluginId): ?string
    {
        $pluginId = trim($pluginId);
        if ($pluginId === '') {
            return null;
        }

        $manifest = $this->manifestPathForPlugin($pluginId);

        return $manifest !== null ? $this->pluginPaths->indexPathForManifest($manifest) : null;
    }

    /**
     * @return list<array{
     *   id: string,
     *   name: string,
     *   active: bool,
     *   source: string,
     *   appTile?: array{id: string, label: string, route: string, icon?: string},
     *   drive?: array{
     *     openFileExtensions?: list<string>,
     *     openFileRoute?: string,
     *     openFileQueryParam?: string,
     *     newFileTemplates?: list<array{
     *       id: string,
     *       label: string,
     *       kind: string,
     *       queryValue: string
     *     }>
     *   },
     *   integration?: array{
     *     configGlobal?: string,
     *     sessionApiPath?: string,
     *     saveTransport?: string,
     *     editorPaths?: list<string>
     *   },
     *   runtime?: array{indexReady: bool, editorReady: bool}
     * }>
     */
    private function loadInstalledPlugins(): array
    {
        $plugins = [];
        foreach ($this->pluginPaths->installedManifestPaths() as $manifestPath) {
            if (! SafePath::isReadable($manifestPath)) {
                continue;
            }
            if ($this->pluginPaths->indexPathForManifest($manifestPath) === null) {
                continue;
            }
            $raw = File::get($manifestPath);
            if ($raw === '') {
                continue;
            }
            try {
                $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            if (! is_array($data)) {
                continue;
            }
            $normalized = $this->normalizeManifestPlugin($data);
            if ($normalized !== null) {
                $plugins[] = $normalized;
            }
        }

        return $plugins;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{
     *   id: string,
     *   name: string,
     *   active: bool,
     *   source: string,
     *   appTile?: array{id: string, label: string, route: string, icon?: string},
     *   drive?: array{
     *     openFileExtensions?: list<string>,
     *     openFileRoute?: string,
     *     openFileQueryParam?: string,
     *     newFileTemplates?: list<array{
     *       id: string,
     *       label: string,
     *       kind: string,
     *       queryValue: string
     *     }>
     *   }
     * }|null
     */
    private function normalizeManifestPlugin(array $data): ?array
    {
        $id = isset($data['id']) && is_string($data['id']) ? trim($data['id']) : '';
        if ($id === '') {
            return null;
        }
        $name = isset($data['name']) && is_string($data['name']) && trim($data['name']) !== ''
            ? trim($data['name'])
            : $id;
        $active = ! isset($data['active']) || (bool) $data['active'];
        $plugin = [
            'id' => $id,
            'name' => $name,
            'active' => $active,
            'source' => 'installed',
        ];

        if (isset($data['appTile']) && is_array($data['appTile'])) {
            $route = isset($data['appTile']['route']) && is_string($data['appTile']['route'])
                ? trim($data['appTile']['route'])
                : '';
            if ($route !== '') {
                $plugin['appTile'] = [
                    'id' => isset($data['appTile']['id']) && is_string($data['appTile']['id']) && trim($data['appTile']['id']) !== ''
                        ? trim($data['appTile']['id'])
                        : $id,
                    'label' => isset($data['appTile']['label']) && is_string($data['appTile']['label']) && trim($data['appTile']['label']) !== ''
                        ? trim($data['appTile']['label'])
                        : $name,
                    'route' => $route,
                ];
                if (isset($data['appTile']['icon']) && is_string($data['appTile']['icon'])) {
                    $icon = trim($data['appTile']['icon']);
                    if ($icon !== '') {
                        $plugin['appTile']['icon'] = $icon;
                    }
                }
            }
        }

        if (isset($data['drive']) && is_array($data['drive'])) {
            $drive = [];
            if (isset($data['drive']['openFileExtensions']) && is_array($data['drive']['openFileExtensions'])) {
                $extensions = [];
                foreach ($data['drive']['openFileExtensions'] as $extension) {
                    if (! is_string($extension)) {
                        continue;
                    }
                    $normalized = strtolower(trim($extension));
                    if ($normalized !== '') {
                        $extensions[] = $normalized;
                    }
                }
                if ($extensions !== []) {
                    $drive['openFileExtensions'] = array_values(array_unique($extensions));
                }
            }
            foreach (['openFileRoute', 'openFileQueryParam'] as $field) {
                if (isset($data['drive'][$field]) && is_string($data['drive'][$field])) {
                    $value = trim($data['drive'][$field]);
                    if ($value !== '') {
                        $drive[$field] = $value;
                    }
                }
            }
            if (isset($data['drive']['newFileTemplates']) && is_array($data['drive']['newFileTemplates'])) {
                $templates = [];
                foreach ($data['drive']['newFileTemplates'] as $template) {
                    if (! is_array($template)) {
                        continue;
                    }
                    $idValue = isset($template['id']) && is_string($template['id']) ? trim($template['id']) : '';
                    $label = isset($template['label']) && is_string($template['label']) ? trim($template['label']) : '';
                    $kind = isset($template['kind']) && is_string($template['kind']) ? trim($template['kind']) : '';
                    $queryValue = isset($template['queryValue']) && is_string($template['queryValue']) ? trim($template['queryValue']) : '';
                    if ($idValue === '' || $label === '' || $queryValue === '') {
                        continue;
                    }
                    if (! in_array($kind, ['doc', 'sheet', 'slides'], true)) {
                        continue;
                    }
                    $templates[] = [
                        'id' => $idValue,
                        'label' => $label,
                        'kind' => $kind,
                        'queryValue' => $queryValue,
                    ];
                }
                if ($templates !== []) {
                    $drive['newFileTemplates'] = $templates;
                }
            }
            if ($drive !== []) {
                $plugin['drive'] = $drive;
            }
        }

        $integration = $this->normalizeIntegration($data);
        if ($integration !== []) {
            $plugin['integration'] = $integration;
        }

        return $plugin;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{
     *   configGlobal?: string,
     *   sessionApiPath?: string,
     *   saveTransport?: string,
     *   editorPaths?: list<string>
     * }
     */
    private function normalizeIntegration(array $data): array
    {
        $source = isset($data['integration']) && is_array($data['integration'])
            ? $data['integration']
            : [];
        $integration = [];
        foreach (['configGlobal', 'sessionApiPath', 'saveTransport'] as $field) {
            if (isset($source[$field]) && is_string($source[$field])) {
                $value = trim($source[$field]);
                if ($value !== '') {
                    $integration[$field] = $value;
                }
            }
        }
        if (isset($source['editorPaths']) && is_array($source['editorPaths'])) {
            $paths = [];
            foreach ($source['editorPaths'] as $editorPath) {
                if (! is_string($editorPath)) {
                    continue;
                }
                $normalized = trim($editorPath);
                if ($normalized !== '') {
                    $paths[] = $normalized;
                }
            }
            if ($paths !== []) {
                $integration['editorPaths'] = array_values(array_unique($paths));
            }
        }

        return $integration;
    }

    /**
     * @param  array<string, mixed>  $plugin
     * @return array{indexReady: bool, editorReady: bool}
     */
    private function runtimeForPlugin(array $plugin): array
    {
        $id = (string) $plugin['id'];
        if ($id === '') {
            return [
                'indexReady' => false,
                'editorReady' => false,
            ];
        }

        $indexPath = $this->assetIndexPath($id);
        $manifest = $this->manifestPathForPlugin($id);

        return [
            'indexReady' => $indexPath !== null,
            'editorReady' => $manifest !== null && $this->pluginPaths->editorReadyForManifest($manifest),
        ];
    }

    /**
     * @return array<string, bool>
     */
    private function activeOverrides(): array
    {
        $value = AppSetting::getValue(self::ACTIVE_OVERRIDES_SETTING, []);
        if (! is_array($value)) {
            return [];
        }
        $normalized = [];
        foreach ($value as $id => $active) {
            if (! is_string($id) || trim($id) === '') {
                continue;
            }
            $normalized[trim($id)] = (bool) $active;
        }

        return $normalized;
    }

    private function manifestPathForPlugin(string $pluginId): ?string
    {
        foreach ($this->pluginPaths->installedManifestPaths() as $manifestPath) {
            if (! SafePath::isReadable($manifestPath)) {
                continue;
            }
            $raw = File::get($manifestPath);
            if ($raw === '') {
                continue;
            }
            try {
                $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            if (! is_array($data)) {
                continue;
            }
            $id = isset($data['id']) && is_string($data['id']) ? trim($data['id']) : '';
            if ($id === $pluginId) {
                return $manifestPath;
            }
        }

        return null;
    }

    private function normalizeRoute(string $route): string
    {
        $route = trim($route);
        if ($route === '') {
            return '';
        }
        if ($route[0] !== '/') {
            $route = '/'.$route;
        }

        return rtrim($route, '/');
    }
}
