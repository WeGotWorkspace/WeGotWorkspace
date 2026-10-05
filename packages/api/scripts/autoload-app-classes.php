<?php

declare(strict_types=1);

/**
 * Autoload every class/interface/trait/enum under a PHP tree.
 *
 * Architecture tests invoke this as a subprocess so an uncatchable fatal
 * (Cannot extend final class) fails that test instead of killing PHPUnit.
 * Local smoke: `composer autoload-app-classes`. Output is type counts and
 * file paths only — no outbound network.
 */

/**
 * @return list<array{file: string, type: string, kind: 'class'|'interface'|'trait'|'enum'}>
 */
function autoload_app_classes_discover(string $root): array
{
    $root = rtrim(str_replace('\\', '/', $root), '/');
    if (! is_dir($root)) {
        return [];
    }

    $files = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($iterator as $file) {
        if (! $file instanceof SplFileInfo || ! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $files[] = str_replace('\\', '/', $file->getPathname());
    }
    sort($files);

    $types = [];
    foreach ($files as $path) {
        foreach (autoload_app_classes_types_in_file($path) as $type) {
            $types[] = $type;
        }
    }

    return $types;
}

/**
 * @return list<array{file: string, type: string, kind: 'class'|'interface'|'trait'|'enum'}>
 */
function autoload_app_classes_types_in_file(string $file): array
{
    $source = file_get_contents($file);
    if (! is_string($source) || $source === '') {
        return [];
    }

    $tokens = token_get_all($source);
    $namespace = '';
    $types = [];
    $count = count($tokens);

    for ($i = 0; $i < $count; $i++) {
        $token = $tokens[$i];
        if (! is_array($token)) {
            continue;
        }

        if ($token[0] === T_NAMESPACE) {
            $namespace = autoload_app_classes_read_qualified_name($tokens, $i);

            continue;
        }

        $kind = match ($token[0]) {
            T_CLASS => 'class',
            T_INTERFACE => 'interface',
            T_TRAIT => 'trait',
            T_ENUM => 'enum',
            default => null,
        };
        if ($kind === null) {
            continue;
        }
        if ($kind === 'class' && autoload_app_classes_is_class_keyword($tokens, $i)) {
            continue;
        }

        $name = autoload_app_classes_read_next_string($tokens, $i);
        if ($name === '') {
            continue;
        }

        $fqcn = $namespace === '' ? $name : $namespace.'\\'.$name;
        $types[] = ['file' => $file, 'type' => $fqcn, 'kind' => $kind];
    }

    return $types;
}

/**
 * @param  array<int, string|array{0: int, 1: string, 2: int}>  $tokens
 */
function autoload_app_classes_is_class_keyword(array $tokens, int $index): bool
{
    $previous = autoload_app_classes_previous_significant($tokens, $index);
    if ($previous === null) {
        return false;
    }
    if (is_string($previous)) {
        return false;
    }

    return $previous[0] === T_DOUBLE_COLON || $previous[0] === T_NEW;
}

/**
 * @param  array<int, string|array{0: int, 1: string, 2: int}>  $tokens
 * @return string|array{0: int, 1: string, 2: int}|null
 */
function autoload_app_classes_previous_significant(array $tokens, int $index): string|array|null
{
    for ($i = $index - 1; $i >= 0; $i--) {
        $token = $tokens[$i];
        if (is_string($token)) {
            if (trim($token) === '') {
                continue;
            }

            return $token;
        }
        if (in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_ATTRIBUTE], true)) {
            continue;
        }

        return $token;
    }

    return null;
}

/**
 * @param  array<int, string|array{0: int, 1: string, 2: int}>  $tokens
 */
function autoload_app_classes_read_qualified_name(array $tokens, int $index): string
{
    $name = '';
    $count = count($tokens);
    for ($i = $index + 1; $i < $count; $i++) {
        $token = $tokens[$i];
        if (is_string($token)) {
            if ($token === ';' || $token === '{' || $token === '(') {
                break;
            }

            continue;
        }
        if (in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        if (in_array($token[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_NS_SEPARATOR], true)) {
            $name .= $token[1];

            continue;
        }
        break;
    }

    return ltrim($name, '\\');
}

/**
 * @param  array<int, string|array{0: int, 1: string, 2: int}>  $tokens
 */
function autoload_app_classes_read_next_string(array $tokens, int $index): string
{
    $count = count($tokens);
    for ($i = $index + 1; $i < $count; $i++) {
        $token = $tokens[$i];
        if (is_string($token)) {
            return '';
        }
        if (in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        if ($token[0] === T_STRING) {
            return $token[1];
        }

        return '';
    }

    return '';
}

/**
 * @param  list<array{file: string, type: string, kind: 'class'|'interface'|'trait'|'enum'}>  $types
 */
function autoload_app_classes_register_classmap(array $types): void
{
    $map = [];
    foreach ($types as $item) {
        $map[$item['type']] = $item['file'];
    }

    spl_autoload_register(static function (string $class) use ($map): void {
        if (! isset($map[$class])) {
            return;
        }
        require_once $map[$class];
    });
}

/**
 * @param  list<array{file: string, type: string, kind: 'class'|'interface'|'trait'|'enum'}>  $types
 * @return list<string>
 */
function autoload_app_classes_load(array $types, bool $registerFallback = false): array
{
    if ($registerFallback) {
        autoload_app_classes_register_classmap($types);
    }

    $failures = [];
    foreach ($types as $item) {
        autoload_app_classes_current_file($item['file']);
        try {
            $loaded = match ($item['kind']) {
                'class' => class_exists($item['type']),
                'interface' => interface_exists($item['type']),
                'trait' => trait_exists($item['type']),
                'enum' => enum_exists($item['type']),
            };
            if (! $loaded) {
                $failures[] = $item['file'].': '.$item['type'].' was not defined after load';
            }
        } catch (Throwable $e) {
            $failures[] = $item['file'].': '.$e->getMessage();
        }
    }
    autoload_app_classes_current_file(null);

    return $failures;
}

function autoload_app_classes_current_file(?string $file = null): ?string
{
    static $current = null;
    if (func_num_args() === 1) {
        $current = $file;
    }

    return $current;
}

function autoload_app_classes_register_shutdown_handler(): void
{
    register_shutdown_function(static function (): void {
        $error = error_get_last();
        if ($error === null) {
            return;
        }
        $fatals = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
        if (! in_array($error['type'], $fatals, true)) {
            return;
        }

        fwrite(STDERR, "autoload-app-classes: FATAL\n");
        fwrite(STDERR, '  '.$error['message'].' in '.$error['file'].':'.$error['line']."\n");
        $loading = autoload_app_classes_current_file();
        if (is_string($loading) && $loading !== '') {
            fwrite(STDERR, '  loading: '.$loading."\n");
        }

        exit(1);
    });
}

/**
 * @param  list<string>  $argv
 */
function autoload_app_classes_main(array $argv): int
{
    $scriptDir = dirname(__FILE__);
    $apiRoot = dirname($scriptDir);
    $root = $apiRoot.'/app';
    $autoload = $apiRoot.'/vendor/autoload.php';
    $customRoot = false;

    foreach (array_slice($argv, 1) as $arg) {
        if (str_starts_with($arg, '--root=')) {
            $root = substr($arg, strlen('--root='));
            $customRoot = true;
        } elseif (str_starts_with($arg, '--autoload=')) {
            $autoload = substr($arg, strlen('--autoload='));
        }
    }

    if (is_file($autoload)) {
        require_once $autoload;
    }

    autoload_app_classes_register_shutdown_handler();

    $types = autoload_app_classes_discover($root);
    // Composer PSR-4 alone for the app tree so a misnamed file is a failure.
    // Classmap fallback is only for --root fixtures (not on the Composer map).
    $failures = autoload_app_classes_load($types, registerFallback: $customRoot);
    if ($failures !== []) {
        fwrite(STDERR, "autoload-app-classes: FAILED\n");
        foreach ($failures as $failure) {
            fwrite(STDERR, '  '.$failure."\n");
        }

        return 1;
    }

    fwrite(STDOUT, 'autoload-app-classes: ok ('.count($types)." types)\n");

    return 0;
}

$cliArguments = $_SERVER['argv'] ?? [];
if (! is_array($cliArguments)) {
    $cliArguments = [];
}

$invokedDirectly = isset($cliArguments[0]) && realpath((string) $cliArguments[0]) === realpath(__FILE__);
if ($invokedDirectly) {
    /** @var list<string> $cliArguments */
    exit(autoload_app_classes_main($cliArguments));
}
