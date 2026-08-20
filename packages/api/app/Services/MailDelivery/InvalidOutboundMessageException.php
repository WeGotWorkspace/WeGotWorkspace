<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use InvalidArgumentException;

final class InvalidOutboundMessageException extends InvalidArgumentException {}
