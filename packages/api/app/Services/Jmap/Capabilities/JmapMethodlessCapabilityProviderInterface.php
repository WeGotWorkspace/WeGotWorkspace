<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

/**
 * A capability that changes how existing methods behave (an extension
 * property or SetError) and has no methods of its own. It is advertised
 * whenever its gate is on, without a registered method.
 */
interface JmapMethodlessCapabilityProviderInterface extends JmapCapabilityProviderInterface {}
