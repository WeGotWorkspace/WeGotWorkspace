<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\UpdateRunner;
use App\Services\Update\UpdateRunnerPackageIo;
use App\Services\Update\UpdateStateStore;
use App\Storage\WgwStorage;
use Tests\Support\Update\FakeHttps;
use Tests\Support\Update\TempTree;
use Tests\Support\Update\UpdateReleaseFixture;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

final class UpdateRunnerPackageIoTest extends TestCase
{
    private string $scratch = '';

    private ?UpdateReleaseFixture $fixture = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scratch = sys_get_temp_dir().'/wgw-pkg-'.uniqid('', true);
        mkdir($this->scratch.'/data', 0775, true);
        $this->fixture = UpdateReleaseFixture::generate($this->scratch.'/keys');
        WgwTestDisks::refresh($this->scratch.'/data');
        config(['wgw.update_public_key_path' => $this->fixture->publicKeyPath]);
        FakeHttps::install();
        foreach ([WgwStorage::class, UpdateStateStore::class, UpdateRunner::class, UpdateRunnerPackageIo::class] as $abstract) {
            $this->app->forgetInstance($abstract);
        }
    }

    protected function tearDown(): void
    {
        FakeHttps::remove();
        if ($this->scratch !== '' && is_dir($this->scratch)) {
            TempTree::remove($this->scratch);
        }
        parent::tearDown();
    }

    public function test_checksum_and_signature_round_trip(): void
    {
        $io = $this->packages();
        $path = $this->scratch.'/payload.bin';
        file_put_contents($path, 'release-bytes');
        $checksum = hash('sha256', 'release-bytes');
        $io->verifyChecksum($path, strtoupper($checksum));
        $this->assertNotNull($this->fixture);
        $io->verifyChecksumSignature($checksum, $this->fixture->sign($checksum));

        try {
            $io->verifyChecksum($path, str_repeat('0', 64));
            $this->fail('Expected a checksum mismatch to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release checksum verification failed.', $e->getMessage());
        }
    }

    public function test_signature_rejects_missing_key_invalid_encoding_and_bad_signature(): void
    {
        $io = $this->packages();
        config(['wgw.update_public_key_path' => $this->scratch.'/missing.pem']);
        try {
            $io->verifyChecksumSignature('abc', base64_encode('x'));
            $this->fail('Expected a missing public key to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Missing update public key for signature verification.', $e->getMessage());
        }

        config(['wgw.update_public_key_path' => $this->fixture?->publicKeyPath]);
        try {
            $io->verifyChecksumSignature('abc', '@@@');
            $this->fail('Expected an invalid signature encoding to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Invalid update signature format.', $e->getMessage());
        }

        try {
            $io->verifyChecksumSignature(str_repeat('ab', 32), base64_encode('not-the-signature'));
            $this->fail('Expected a bad signature to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release signature verification failed.', $e->getMessage());
        }
    }

    public function test_default_public_key_path_is_the_packaged_key(): void
    {
        config(['wgw.update_public_key_path' => '']);
        try {
            $this->packages()->verifyChecksumSignature('abc', base64_encode('not-the-signature'));
            $this->fail('Expected the packaged key to reject a bad signature.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release signature verification failed.', $e->getMessage());
        }
    }

    public function test_extracts_release_and_rejects_corrupt_or_empty_archives(): void
    {
        $io = $this->packages();
        $this->assertNotNull($this->fixture);
        $bytes = $this->fixture->zip([
            'VERSION' => "0.2.0\n",
            'packages/apps/marker.txt' => "apps-new\n",
        ]);
        $zipPath = $this->scratch.'/release.zip';
        file_put_contents($zipPath, $bytes);
        $staging = $this->scratch.'/staging';
        $io->extractPackage($zipPath, $staging, '0.1.0', '0.2.0');
        $root = $io->resolveReleaseRoot($staging);
        $this->assertSame($staging.'/release', $root);
        $this->assertSame("0.2.0\n", file_get_contents($root.'/VERSION'));

        try {
            $io->extractPackage($this->scratch.'/missing.zip', $this->scratch.'/nope', '0.1.0', '0.2.0');
            $this->fail('Expected a missing archive to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not open release ZIP.', $e->getMessage());
        }

        $empty = $this->scratch.'/empty.zip';
        file_put_contents($empty, "PK\x05\x06".str_repeat("\x00", 18));
        try {
            $io->extractPackage($empty, $this->scratch.'/empty-out', '0.1.0', '0.2.0');
            $this->fail('Expected an empty archive to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release ZIP is empty.', $e->getMessage());
        }
    }

    public function test_download_writes_package_and_drops_empty_or_unreachable_payloads(): void
    {
        $io = $this->packages();
        FakeHttps::$bodies['https://updates.test/pkg.zip'] = 'zip-bytes';
        $target = $this->scratch.'/data/updates/tmp/release.zip';
        if (! is_dir(dirname($target))) {
            mkdir(dirname($target), 0775, true);
        }
        $io->downloadPackage('https://updates.test/pkg.zip', $target, '0.1.0', '0.2.0');
        $this->assertSame('zip-bytes', file_get_contents($target));
        $state = app(UpdateStateStore::class)->read();
        $this->assertSame('downloading', $state['phase']);
        $this->assertSame(9, $state['download']['downloadedBytes']);

        FakeHttps::$bodies['https://updates.test/empty.zip'] = '';
        $emptyTarget = $this->scratch.'/empty.zip';
        try {
            $io->downloadPackage('https://updates.test/empty.zip', $emptyTarget, '0.1.0', '0.2.0');
            $this->fail('Expected an empty download to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not download release package.', $e->getMessage());
        }
        $this->assertFileDoesNotExist($emptyTarget);
        $this->assertFileDoesNotExist($emptyTarget.'.part');

        try {
            $io->downloadPackage('https://updates.test/missing.zip', $this->scratch.'/missing.zip', '0.1.0', '0.2.0');
            $this->fail('Expected an unreachable download to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not download release package.', $e->getMessage());
        }
        $this->assertFileDoesNotExist($this->scratch.'/missing.zip');

        app(UpdateStateStore::class)->requestCancel();
        try {
            $io->downloadPackage('https://updates.test/pkg.zip', $this->scratch.'/cancelled.zip', '0.1.0', '0.2.0');
            $this->fail('Expected a cancel request to stop the download.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Update cancelled by user.', $e->getMessage());
        }
    }

    public function test_latest_from_state_requires_a_prior_check(): void
    {
        try {
            $this->packages()->latestFromState();
            $this->fail('Expected missing release metadata to fail.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('No checked update metadata found', $e->getMessage());
        }
    }

    private function packages(): UpdateRunnerPackageIo
    {
        $runner = app(UpdateRunner::class);
        $packages = (new \ReflectionProperty($runner, 'packages'))->getValue($runner);
        $this->assertInstanceOf(UpdateRunnerPackageIo::class, $packages);

        return $packages;
    }
}
