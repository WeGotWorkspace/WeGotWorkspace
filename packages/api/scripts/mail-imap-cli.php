#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * CLI worker for mail IMAP (see MailImapProcess). Avoids ext-imap segfaults under Apache mod_php.
 *
 * Usage: php mail-imap-cli.php <operation> <username> <base64-json-params>
 */

use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Mail\MailBinaryDownload;
use App\Services\Mail\MailOperationService;
use App\Services\Mail\MailResponseException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;

if ($argc < 3) {
    fwrite(STDERR, "usage: mail-imap-cli.php <operation> <username> [base64-json-params]\n");
    exit(2);
}

ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);

putenv('WGW_MAIL_IMAP_SUBPROCESS=1');
$_ENV['WGW_MAIL_IMAP_SUBPROCESS'] = '1';

define('LARAVEL_START', microtime(true));

require __DIR__.'/../vendor/autoload.php';

/** @var Application $app */
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$operation = $argv[1];
$username = $argv[2];
$params = [];
if (isset($argv[3]) && $argv[3] !== '') {
    $raw = base64_decode($argv[3], true);
    if ($raw === false) {
        fwrite(STDERR, "invalid params payload\n");
        exit(2);
    }
    $decoded = json_decode($raw, true);
    $params = is_array($decoded) ? $decoded : [];
}

/** @var MailOperationService $mail */
$mail = $app->make(MailOperationService::class);

try {
    $result = match ($operation) {
        'listFolders' => $mail->listFolders($username),
        'createFolder' => $mail->createFolder($username, $params),
        'moveFolder' => $mail->moveFolder($username, $params),
        'deleteFolder' => $mail->deleteFolder($username, $params),
        'listMessages' => $mail->listMessages($username, $params),
        'listMessageAttachments' => $mail->listMessageAttachments($username, $params),
        'getMessage' => $mail->getMessage($username, $params),
        'downloadAttachment' => $mail->downloadAttachment($username, $params),
        'patchMessage' => $mail->patchMessage($username, $params),
        'deleteMessage' => $mail->deleteMessage($username, $params),
        'moveMessage' => $mail->moveMessage($username, $params),
        'send' => $mail->send($username, $params),
        'saveDraft' => $mail->saveDraft($username, $params),
        'jmapDispatch' => $app->make(JmapMethodDispatcher::class)->dispatch(
            $username,
            is_array($params['using'] ?? null) ? $params['using'] : [],
            is_array($params['methodCalls'] ?? null) ? $params['methodCalls'] : [],
        ),
        default => throw new InvalidArgumentException('Unknown mail IMAP operation: '.$operation),
    };

    echo json_encode([
        'ok' => true,
        'result' => serialize_mail_imap_result($result),
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (MailResponseException $e) {
    echo json_encode([
        'ok' => false,
        'mailError' => [
            'status' => $e->status,
            'payload' => $e->payload,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage()."\n");
    exit(1);
}

/**
 * @return array<string, mixed>
 */
function serialize_mail_imap_result(mixed $result): array
{
    if ($result instanceof MailBinaryDownload) {
        return [
            '__binary' => true,
            'mime' => $result->mime,
            'filename' => $result->filename,
            'bytes' => base64_encode($result->bytes),
        ];
    }

    if (! is_array($result)) {
        throw new RuntimeException('Mail operation returned unexpected type.');
    }

    return $result;
}
