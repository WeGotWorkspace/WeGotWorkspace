<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Contacts\CardUid;
use Illuminate\Support\Facades\DB;
use Sabre\CardDAV\Backend\PDO as CardPDO;

/**
 * The single CardDAV backend. Every card write goes through here, from DAV
 * and from the app alike.
 *
 * It stores each card's normalized UID in `cards.uid` ({@see CardUid}) and
 * refuses a write that would put a second card with the same UID in one
 * address book (RFC 6352 §5.1). The check runs before the write; the
 * `UNIQUE(addressbookid, uid)` index catches a concurrent write that got past
 * it. Both surface as {@see CardUidConflict}.
 */
final class WgwCardBackend extends CardPDO
{
    private const SQLSTATE_INTEGRITY = '23000';

    /** Sabre types its `$pdo` property loosely; keep a typed handle. */
    private readonly \PDO $connection;

    public function __construct(\PDO $pdo)
    {
        parent::__construct($pdo);
        $this->connection = $pdo;
    }

    public static function fromConnection(): self
    {
        return new self(DB::connection('wgw')->getPdo());
    }

    /**
     * @param  mixed  $addressBookId
     * @param  string  $cardUri
     * @param  string|resource  $cardData
     * @return string
     */
    public function createCard($addressBookId, $cardUri, $cardData)
    {
        $bookId = (int) $addressBookId;
        $cardData = self::cardDataString($cardData);
        $uid = CardUid::forCardData($cardData);
        $this->assertUidFree($bookId, $uid, null);

        $etag = md5($cardData);
        $this->writeGuarded($bookId, $uid, null, function () use ($bookId, $cardUri, $cardData, $uid, $etag): void {
            $stmt = $this->connection->prepare('INSERT INTO '.$this->cardsTableName
                .' (carddata, uri, lastmodified, addressbookid, size, etag, uid)'
                .' VALUES (:carddata, :uri, :lastmodified, :addressbookid, :size, :etag, :uid)');
            $stmt->bindValue('carddata', $cardData, \PDO::PARAM_LOB);
            $stmt->bindValue('uri', (string) $cardUri, \PDO::PARAM_STR);
            $stmt->bindValue('lastmodified', time(), \PDO::PARAM_INT);
            $stmt->bindValue('addressbookid', $bookId, \PDO::PARAM_INT);
            $stmt->bindValue('size', strlen($cardData), \PDO::PARAM_INT);
            $stmt->bindValue('etag', $etag, \PDO::PARAM_STR);
            $stmt->bindValue('uid', $uid, $uid === null ? \PDO::PARAM_NULL : \PDO::PARAM_STR);
            $stmt->execute();
        });

        $this->addChange($bookId, $cardUri, 1);

        return '"'.$etag.'"';
    }

    /**
     * @param  mixed  $addressBookId
     * @param  string  $cardUri
     * @param  string|resource  $cardData
     * @return string
     */
    public function updateCard($addressBookId, $cardUri, $cardData)
    {
        $bookId = (int) $addressBookId;
        $cardData = self::cardDataString($cardData);
        $uid = CardUid::forCardData($cardData);
        $this->assertUidFree($bookId, $uid, (string) $cardUri);

        $etag = md5($cardData);
        $this->writeGuarded($bookId, $uid, (string) $cardUri, function () use ($bookId, $cardUri, $cardData, $uid, $etag): void {
            $stmt = $this->connection->prepare('UPDATE '.$this->cardsTableName
                .' SET carddata = :carddata, lastmodified = :lastmodified, size = :size, etag = :etag, uid = :uid'
                .' WHERE uri = :uri AND addressbookid = :addressbookid');
            $stmt->bindValue('carddata', $cardData, \PDO::PARAM_LOB);
            $stmt->bindValue('lastmodified', time(), \PDO::PARAM_INT);
            $stmt->bindValue('size', strlen($cardData), \PDO::PARAM_INT);
            $stmt->bindValue('etag', $etag, \PDO::PARAM_STR);
            $stmt->bindValue('uid', $uid, $uid === null ? \PDO::PARAM_NULL : \PDO::PARAM_STR);
            $stmt->bindValue('uri', (string) $cardUri, \PDO::PARAM_STR);
            $stmt->bindValue('addressbookid', $bookId, \PDO::PARAM_INT);
            $stmt->execute();
        });

        $this->addChange($bookId, $cardUri, 2);

        return '"'.$etag.'"';
    }

    /**
     * Rename a card within its book (CardDAV MOVE to a new URI in the same
     * book). The UID does not change, so no UID check applies. The sync log
     * records the old URI as deleted and the new one as added.
     */
    public function renameCard(int $addressBookId, string $cardUri, string $newCardUri): bool
    {
        $stmt = $this->connection->prepare('UPDATE '.$this->cardsTableName
            .' SET uri = ? WHERE addressbookid = ? AND uri = ?');
        $stmt->execute([$newCardUri, $addressBookId, $cardUri]);
        if ($stmt->rowCount() === 0) {
            return false;
        }
        $this->addChange($addressBookId, $cardUri, 3);
        $this->addChange($addressBookId, $newCardUri, 1);

        return true;
    }

    /**
     * URI of the card in this book that holds the normalized UID.
     */
    public function findCardUriByUid(int $addressBookId, string $normalizedUid, ?string $exceptCardUri = null): ?string
    {
        $sql = 'SELECT uri FROM '.$this->cardsTableName.' WHERE addressbookid = ? AND uid = ?';
        $params = [$addressBookId, $normalizedUid];
        if ($exceptCardUri !== null) {
            $sql .= ' AND uri <> ?';
            $params[] = $exceptCardUri;
        }
        $stmt = $this->connection->prepare($sql.' ORDER BY id LIMIT 1');
        $stmt->execute($params);
        $uri = $stmt->fetchColumn();

        return is_string($uri) ? $uri : null;
    }

    /**
     * Give one row of a duplicated (addressbookid, uri) pair a new URI.
     * Repair-only: Sabre's MySQL schema never enforced unique URIs. The sync
     * log gets the new URI as added and the old one as modified, so clients
     * fetch both again.
     */
    public function moveDuplicateUriRow(int $cardId, string $newCardUri): void
    {
        $stmt = $this->connection->prepare('SELECT addressbookid, uri FROM '.$this->cardsTableName.' WHERE id = ?');
        $stmt->execute([$cardId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (! is_array($row)) {
            return;
        }

        $this->connection->prepare('UPDATE '.$this->cardsTableName.' SET uri = ? WHERE id = ?')
            ->execute([$newCardUri, $cardId]);
        $this->addChange((int) $row['addressbookid'], $newCardUri, 1);
        $this->addChange((int) $row['addressbookid'], (string) $row['uri'], 2);
    }

    private function assertUidFree(int $addressBookId, ?string $uid, ?string $exceptCardUri): void
    {
        if ($uid === null) {
            return;
        }
        $existingUri = $this->findCardUriByUid($addressBookId, $uid, $exceptCardUri);
        if ($existingUri !== null) {
            throw $this->conflict($addressBookId, $existingUri);
        }
    }

    /**
     * Run a write; a unique-index violation on the UID becomes a conflict.
     */
    private function writeGuarded(int $addressBookId, ?string $uid, ?string $exceptCardUri, callable $write): void
    {
        try {
            $write();
        } catch (\PDOException $e) {
            throw $this->conflictForWriteError($e, $addressBookId, $uid, $exceptCardUri) ?? $e;
        }
    }

    /**
     * A write that lost a race to another card with the same UID fails on the
     * unique index. That is the same conflict the pre-check reports.
     */
    public function conflictForWriteError(
        \PDOException $e,
        int $addressBookId,
        ?string $uid,
        ?string $exceptCardUri = null,
    ): ?CardUidConflict {
        if ($uid === null || ! self::isIntegrityViolation($e)) {
            return null;
        }
        $existingUri = $this->findCardUriByUid($addressBookId, $uid, $exceptCardUri);

        return $existingUri === null ? null : $this->conflict($addressBookId, $existingUri);
    }

    private function conflict(int $addressBookId, string $existingCardUri): CardUidConflict
    {
        $stmt = $this->connection->prepare('SELECT principaluri, uri FROM '.$this->addressBooksTableName.' WHERE id = ?');
        $stmt->execute([$addressBookId]);
        $book = $stmt->fetch(\PDO::FETCH_ASSOC);
        $home = is_array($book) ? (preg_replace('#^principals/#', '', (string) $book['principaluri']) ?? '') : '';
        $bookUri = is_array($book) ? (string) $book['uri'] : '';

        return new CardUidConflict('addressbooks/'.$home.'/'.$bookUri.'/'.$existingCardUri, $existingCardUri);
    }

    private static function isIntegrityViolation(\PDOException $e): bool
    {
        $state = $e->errorInfo[0] ?? $e->getCode();

        return (string) $state === self::SQLSTATE_INTEGRITY;
    }

    /**
     * @param  string|resource  $cardData
     */
    private static function cardDataString(mixed $cardData): string
    {
        if (is_resource($cardData)) {
            return (string) stream_get_contents($cardData);
        }

        return (string) $cardData;
    }
}
