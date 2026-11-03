<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Services\Jmap\Capabilities\BlobAssemblyCapabilityProvider;
use App\Services\Jmap\Capabilities\FileNodeVersionCheckCapabilityProvider;
use App\Services\Jmap\Capabilities\FilesCapabilityProvider;
use App\Services\Jmap\Capabilities\JmapCapabilityProviderInterface;
use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\Methods\BlobAssemblyAppendMethod;
use App\Services\Jmap\Methods\BlobAssemblyFinishMethod;
use App\Services\Jmap\Methods\BlobAssemblyGetMethod;
use App\Services\Jmap\Methods\BlobAssemblySetMethod;
use App\Services\Jmap\Methods\CoreEchoMethod;
use App\Services\Jmap\Methods\JmapMethodInterface;

/**
 * The JMAP envelope a guest upload account gets (#1715): its own method
 * list and capability set, so everything not listed here fails closed with
 * `unknownMethod` / `unknownCapability`. No Blob/upload, Blob/get, copy,
 * changes, or Quota (the owner's usage and free space stay private), and
 * FileNode reads one folder at a time.
 */
final class GuestJmapGateway
{
    /** @var list<class-string<JmapMethodInterface>> */
    public const METHODS = [
        CoreEchoMethod::class,
        GuestFileNodeGetMethod::class,
        GuestFileNodeQueryMethod::class,
        GuestFileNodeSetMethod::class,
        BlobAssemblySetMethod::class,
        BlobAssemblyAppendMethod::class,
        BlobAssemblyFinishMethod::class,
        BlobAssemblyGetMethod::class,
    ];

    /** @var list<class-string<JmapCapabilityProviderInterface>> */
    public const PROVIDERS = [
        FilesCapabilityProvider::class,
        BlobAssemblyCapabilityProvider::class,
        FileNodeVersionCheckCapabilityProvider::class,
    ];

    public function __construct(
        public readonly JmapMethodDispatcher $dispatcher,
        public readonly JmapCapabilitySet $capabilities,
    ) {}

    /**
     * The guest Session resource (RFC 8620 §2). Only `apiUrl` and `uploadUrl`
     * are served; guests read files through `GET /files/content` and get no
     * push, so the download and event source templates are not routed.
     *
     * @return array<string, mixed>
     */
    public function session(GuestUploadAccount $account): array
    {
        $base = rtrim(url('/api/v1/jmap/guest'), '/');
        $name = basename($account->rootPath);

        return [
            'capabilities' => $this->capabilities->sessionCapabilities(),
            'accounts' => [
                $account->accountId => [
                    'name' => $name !== '' ? $name : $account->accountId,
                    'isPersonal' => false,
                    'isReadOnly' => false,
                    'accountCapabilities' => $this->capabilities->accountCapabilities(),
                ],
            ],
            'primaryAccounts' => $this->capabilities->primaryAccounts($account->accountId),
            'username' => $account->principal['username'],
            'apiUrl' => $base,
            'downloadUrl' => $base.'/download/{accountId}/{blobId}/{name}?type={type}',
            'uploadUrl' => $base.'/upload/{accountId}',
            'eventSourceUrl' => $base.'/events/{types}/{closeafter}/{ping}',
            'state' => $this->capabilities->sessionState(),
        ];
    }
}
